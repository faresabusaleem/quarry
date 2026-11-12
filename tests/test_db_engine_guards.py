"""The engine-level guarantees hold even when the SQL checker is bypassed entirely."""

import duckdb
import pytest

from quarry.tools.db import Database, execute_with_limits


@pytest.mark.parametrize(
    "sql",
    [
        "DROP TABLE orders",
        "DELETE FROM orders",
        "CREATE TABLE evil AS SELECT 1",
        "INSERT INTO category_translation VALUES ('a', 'b')",
        "UPDATE orders SET order_status = 'x'",
    ],
)
def test_writes_are_impossible(db: Database, sql: str) -> None:
    with pytest.raises(duckdb.Error):
        db.cursor().execute(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM read_csv('/etc/hosts')",
        "SELECT * FROM read_text('/etc/hosts')",
        "COPY orders TO '/tmp/quarry_exfil.csv'",
        "ATTACH '/tmp/quarry_other.duckdb' AS other",
        "INSTALL httpfs",
    ],
)
def test_file_and_network_access_is_disabled(db: Database, sql: str) -> None:
    with pytest.raises(duckdb.Error):
        db.cursor().execute(sql)


def test_configuration_is_locked(db: Database) -> None:
    with pytest.raises(duckdb.Error):
        db.cursor().execute("SET enable_external_access = true")


def test_timeout_interrupts_long_queries(db: Database) -> None:
    with pytest.raises(TimeoutError):
        execute_with_limits(
            db.cursor(),
            "SELECT COUNT(*) FROM range(100000000000) a",
            max_rows=10,
            timeout_s=0.5,
        )


def test_row_cap_truncates_without_rewriting_sql(db: Database) -> None:
    res = execute_with_limits(
        db.cursor(), "SELECT order_id FROM orders ORDER BY order_id", max_rows=50, timeout_s=5
    )
    assert len(res.rows) == 50
    assert res.truncated
    assert res.rows[0][0] <= res.rows[1][0]
