"""Read-only DuckDB access.

Safety here does not depend on the prompt or on the SQL checker. The engine itself is
configured so that writes and file or network access are impossible:

- read_only=True: DuckDB rejects INSERT/UPDATE/DELETE/CREATE/DROP at the storage layer.
- enable_external_access=false: no read_csv('/etc/passwd'), no ATTACH, no httpfs, no COPY TO.
- autoinstall/autoload of extensions disabled: a query cannot pull in new code.
- lock_configuration=true: a query cannot SET any of the above back.

The SQL checker in sql_guard.py is a second, friendlier layer that gives the agent a clear
error message; this module is the layer that actually enforces the rules.
"""

from __future__ import annotations

import datetime as dt
import decimal
import threading
import time
import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import duckdb

SAFE_CONFIG = {
    "enable_external_access": False,
    "autoinstall_known_extensions": False,
    "autoload_known_extensions": False,
}


@dataclass
class QueryResult:
    columns: list[str]
    types: list[str]
    rows: list[list[Any]]
    truncated: bool
    elapsed_ms: float


@dataclass
class Database:
    path: Path
    memory_limit: str = "2GB"
    threads: int = 4
    _con: duckdb.DuckDBPyConnection | None = field(default=None, repr=False)

    def connect(self) -> duckdb.DuckDBPyConnection:
        if self._con is None:
            if not self.path.exists():
                raise FileNotFoundError(f"{self.path} not found; run `make data` first")
            config: dict[str, Any] = {
                **SAFE_CONFIG,
                "memory_limit": self.memory_limit,
                "threads": self.threads,
            }
            con = duckdb.connect(str(self.path), read_only=True, config=config)
            # Lock last, after every setting above is in place.
            con.execute("SET lock_configuration = true")
            self._con = con
        return self._con

    def cursor(self) -> duckdb.DuckDBPyConnection:
        """A separate connection to the same database, safe to use from another thread."""
        return self.connect().cursor()

    def tables(self) -> list[str]:
        rows = (
            self.cursor()
            .execute("SELECT table_name FROM duckdb_tables() WHERE schema_name = 'main' ORDER BY 1")
            .fetchall()
        )
        return [r[0] for r in rows]


def execute_with_limits(
    con: duckdb.DuckDBPyConnection, sql: str, *, max_rows: int, timeout_s: float
) -> QueryResult:
    """Run one query with a wall-clock timeout and a row cap.

    The row cap uses fetchmany instead of rewriting the SQL, so the agent's ORDER BY and
    LIMIT semantics are untouched; we read one extra row only to know if we truncated.
    """
    timer = threading.Timer(timeout_s, con.interrupt)
    start = time.perf_counter()
    timer.start()
    try:
        cur = con.execute(sql)
        description = cur.description or []
        raw = cur.fetchmany(max_rows + 1)
    except duckdb.InterruptException as exc:
        raise TimeoutError(f"query exceeded the {timeout_s:.0f}s time limit") from exc
    finally:
        timer.cancel()
    elapsed = (time.perf_counter() - start) * 1000
    columns = [d[0] for d in description]
    types = [str(d[1]) for d in description]
    truncated = len(raw) > max_rows
    rows = [list(r) for r in raw[:max_rows]]
    return QueryResult(columns, types, rows, truncated, elapsed)


def to_jsonable(value: Any) -> Any:
    """Convert DuckDB values to JSON-friendly Python values."""
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return value if value == value and abs(value) != float("inf") else None
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, dt.datetime | dt.date | dt.time):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return value.total_seconds()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, list | tuple):
        return [to_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    return str(value)


@lru_cache(maxsize=4)
def get_database(path: str, memory_limit: str = "2GB") -> Database:
    return Database(Path(path), memory_limit=memory_limit)
