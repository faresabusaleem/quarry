import pytest

from quarry.tools.sql_guard import check_sql

TABLES = ["orders", "order_items", "products", "category_translation", "customers"]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT COUNT(*) FROM orders",
        "select order_status, count(*) from orders group by 1 order by 2 desc",
        "WITH m AS (SELECT date_trunc('month', order_purchase_timestamp) AS m FROM orders) "
        "SELECT m, COUNT(*) FROM m GROUP BY ALL",
        "SELECT t.product_category_name_english, SUM(oi.price) FROM order_items oi "
        "JOIN products p USING (product_id) JOIN category_translation t USING (product_category_name) "
        "GROUP BY 1 QUALIFY row_number() OVER (ORDER BY 2 DESC) <= 5",
        "FROM orders LIMIT 3",
        "SELECT * EXCLUDE (customer_id) FROM orders LIMIT 1",
        "SELECT 1 UNION ALL SELECT 2",
        "SELECT * FROM generate_series(DATE '2017-01-01', DATE '2017-12-01', INTERVAL 1 MONTH)",
        "SELECT * FROM main.orders LIMIT 1",
        "SELECT COUNT(*) FILTER (WHERE order_status = 'delivered') FROM orders;",
    ],
)
def test_allows_read_only_queries(sql: str) -> None:
    result = check_sql(sql, TABLES)
    assert result.ok, result.reason


@pytest.mark.parametrize(
    ("sql", "fragment"),
    [
        ("DROP TABLE orders", "read-only"),
        ("DELETE FROM orders", "read-only"),
        ("UPDATE orders SET order_status = 'x'", "read-only"),
        ("INSERT INTO orders SELECT * FROM orders", "read-only"),
        ("CREATE TABLE x AS SELECT 1", "read-only"),
        ("ALTER TABLE orders ADD COLUMN x INT", "read-only"),
        ("SELECT 1; DROP TABLE orders", "exactly one statement"),
        ("SELECT 1; SELECT 2", "exactly one statement"),
        ("PRAGMA database_list", "read-only"),
        ("ATTACH 'other.db' AS o", "read-only"),
        ("COPY orders TO 'out.csv'", "read-only"),
        ("INSTALL httpfs", "read-only"),
        ("LOAD httpfs", "read-only"),
        ("SET memory_limit = '100GB'", "read-only"),
        ("SELECT * FROM read_csv('/etc/passwd')", "read_csv"),
        ("SELECT * FROM read_parquet('s3://bucket/x.parquet')", "read_parquet"),
        ("SELECT * FROM 'data/raw/olist/olist_orders_dataset.csv'", "unknown table"),
        ("SELECT * FROM query('DROP TABLE orders')", "query"),
        ("SELECT getenv('GEMINI_API_KEY')", "getenv"),
        ("SELECT * FROM secrets", "unknown table"),
        ("SELECT * FROM information_schema.tables", "schema"),
        ("SELECT * FROM glob('/Users/*')", "glob"),
        ("", "empty"),
        ("SELEC * FROM orders", "syntax error"),
        ("SELECT " + "1," * 5000 + "1", "longer than"),
    ],
)
def test_rejects_unsafe_or_invalid(sql: str, fragment: str) -> None:
    result = check_sql(sql, TABLES)
    assert not result.ok
    assert fragment in result.reason


def test_cte_names_are_allowed_but_tracked_tables_are_real() -> None:
    result = check_sql("WITH recent AS (SELECT * FROM orders) SELECT COUNT(*) FROM recent", TABLES)
    assert result.ok
    assert result.tables == ["orders"]


def test_parse_failures_are_explained_in_duckdb_terms() -> None:
    result = check_sql("SELECT AVG(OR.review_score) FROM order_reviews OR", ["order_reviews"])
    assert not result.ok
    assert 'syntax error at or near "OR"' in result.reason
    assert "reserved words" in result.reason
