"""Static checks on agent-written SQL before it reaches the database.

This is the friendly layer: it rejects anything that is not a single read-only query and
explains why, so the agent can fix its own mistake. The hard guarantee comes from the
engine configuration in db.py; this module never has to be perfect, only helpful, and it
fails closed (anything it cannot parse is rejected).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

import duckdb
import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

MAX_SQL_CHARS = 8_000

# Statement types that may appear as the root of a query.
_ALLOWED_ROOTS: tuple[type[exp.Expression], ...] = (exp.Select, exp.SetOperation, exp.Pivot)

# Node types that must not appear anywhere in the tree.
_FORBIDDEN_NODES: tuple[type[exp.Expression], ...] = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Create,
    exp.Drop,
    exp.Alter,
    exp.Merge,
    exp.Command,
    exp.Copy,
    exp.Set,
    exp.Pragma,
    exp.Transaction,
    exp.Commit,
    exp.Rollback,
    exp.Use,
    exp.Attach,
    exp.Detach,
    exp.Install,
    exp.LoadData,
    exp.Into,
    exp.Export,
)

# Functions that read files, other databases, the environment, or run SQL from a string.
_FORBIDDEN_FUNCTIONS = {
    "read_csv",
    "read_csv_auto",
    "read_parquet",
    "parquet_scan",
    "parquet_metadata",
    "parquet_schema",
    "read_json",
    "read_json_auto",
    "read_json_objects",
    "read_ndjson",
    "read_ndjson_auto",
    "read_ndjson_objects",
    "read_text",
    "read_blob",
    "read_xlsx",
    "sniff_csv",
    "glob",
    "query",
    "query_table",
    "sqlite_scan",
    "sqlite_attach",
    "postgres_scan",
    "postgres_attach",
    "mysql_scan",
    "iceberg_scan",
    "delta_scan",
    "getenv",
    "duckdb_secrets",
    "which_secret",
}

# Table-valued functions that are pure computation and handy for date spines.
_ALLOWED_TABLE_FUNCTIONS = {"generate_series", "range", "unnest"}


@dataclass
class GuardResult:
    ok: bool
    reason: str = ""
    tables: list[str] = field(default_factory=list)

    @classmethod
    def reject(cls, reason: str) -> GuardResult:
        return cls(ok=False, reason=reason)


def _func_name(node: exp.Func) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.name).lower()
    return node.sql_name().lower()


def _reject_unparseable(text: str, exc: ParseError) -> GuardResult:
    """Explain a parse failure in DuckDB's own words.

    sqlglot's messages ("Required keyword: 'this' missing for Or") mean nothing to a model;
    v1-v3 traces show the agent resending the same query up to five times after one. DuckDB's
    parser says "syntax error at or near "OR"", which points at the actual mistake (here, a
    reserved word used as a table alias). The query is still rejected either way.
    """
    try:
        duckdb.extract_statements(text)
    except duckdb.Error as db_exc:
        first = str(db_exc).splitlines()[0]
        return GuardResult.reject(
            f"{first}. Check for reserved words used as aliases (OR, AS, ON, BY, TO, DO)."
        )
    first = str(exc).splitlines()[0]
    return GuardResult.reject(
        f"the query checker could not parse this query ({first}). Rewrite it in plainer "
        "SQL: short aliases that are not keywords, explicit GROUP BY columns."
    )


def check_sql(sql: str, allowed_tables: Iterable[str]) -> GuardResult:
    allowed = {t.lower() for t in allowed_tables}
    text = sql.strip()
    if not text:
        return GuardResult.reject("empty query")
    if len(text) > MAX_SQL_CHARS:
        return GuardResult.reject(f"query is longer than {MAX_SQL_CHARS} characters")

    try:
        statements = [s for s in sqlglot.parse(text, read="duckdb") if s is not None]
    except ParseError as exc:
        return _reject_unparseable(text, exc)
    if len(statements) != 1:
        return GuardResult.reject(
            f"exactly one statement is allowed, got {len(statements)}. Remove extra statements."
        )
    root = statements[0]

    if not isinstance(root, _ALLOWED_ROOTS):
        return GuardResult.reject(
            f"only read-only SELECT queries are allowed, got {root.key.upper()}. "
            "The database is read-only."
        )

    for node in root.walk():
        if isinstance(node, _FORBIDDEN_NODES):
            return GuardResult.reject(
                f"{node.key.upper()} is not allowed. Only read-only SELECT queries can run."
            )
        if isinstance(node, exp.Func) and _func_name(node) in _FORBIDDEN_FUNCTIONS:
            return GuardResult.reject(
                f"function {_func_name(node)}() is not allowed: queries may only read the "
                "warehouse tables, not files, other databases or the environment."
            )

    cte_names = {cte.alias_or_name.lower() for cte in root.find_all(exp.CTE)}
    used: list[str] = []
    for table in root.find_all(exp.Table):
        if isinstance(table.this, exp.Func):
            fname = _func_name(table.this)
            if fname not in _ALLOWED_TABLE_FUNCTIONS:
                return GuardResult.reject(f"table function {fname}() is not allowed.")
            continue
        name = table.name.lower()
        schema = (table.db or "").lower()
        if schema and schema != "main":
            return GuardResult.reject(f"schema {schema!r} is not available; use the main tables.")
        if name in cte_names:
            continue
        if name not in allowed:
            known = ", ".join(sorted(allowed))
            return GuardResult.reject(f"unknown table {table.name!r}. Available tables: {known}.")
        used.append(name)

    return GuardResult(ok=True, tables=sorted(set(used)))
