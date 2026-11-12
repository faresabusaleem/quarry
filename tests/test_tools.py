from quarry.tools.base import RunContext
from quarry.tools.interaction import value_in_result
from quarry.tools.registry import ToolRegistry

REG = ToolRegistry.default(python_enabled=False)


def call(ctx: RunContext, name: str, **args):
    return REG.execute(name, args, ctx)


def test_specs_are_plain_json_schema() -> None:
    for spec in REG.specs():
        assert spec.parameters["type"] == "object"
        assert "$defs" not in str(spec.parameters)
        assert "anyOf" not in str(spec.parameters)


def test_list_tables(ctx: RunContext) -> None:
    res = call(ctx, "list_tables")
    assert res.ok
    names = {t["table"] for t in res.data["tables"]}
    assert {"orders", "order_items", "products", "customers"} <= names
    assert "orders (99,441 rows)" in res.content


def test_describe_table_includes_meanings_and_values(ctx: RunContext) -> None:
    res = call(ctx, "describe_table", table="orders")
    assert res.ok
    assert "customer_unique_id" in res.content  # from the column comment
    status = next(c for c in res.data["columns"] if c["column"] == "order_status")
    assert {"value": "delivered", "count": 96478} in status["top_values"]


def test_describe_unknown_table(ctx: RunContext) -> None:
    res = call(ctx, "describe_table", table="sales")
    assert not res.ok
    assert "Available" in res.error


def test_sample_rows_is_repeatable_and_fenced(ctx: RunContext) -> None:
    a = call(ctx, "sample_rows", table="sellers", n=3)
    b = call(ctx, "sample_rows", table="sellers", n=3)
    assert a.data["rows"] == b.data["rows"]
    assert f"id={ctx.nonce}" in a.content


def test_sample_rows_validates_arguments(ctx: RunContext) -> None:
    res = call(ctx, "sample_rows", table="sellers", n=50)
    assert not res.ok
    assert "invalid arguments" in res.error


def test_run_sql_success_registers_query(ctx: RunContext) -> None:
    res = call(ctx, "run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="count orders")
    assert res.ok
    assert res.data["id"] == "q1"
    assert ctx.queries["q1"].rows == [[99441]]


def test_run_sql_error_is_readable_for_self_correction(ctx: RunContext) -> None:
    res = call(ctx, "run_sql", sql="SELECT order_date FROM orders", purpose="bad column")
    assert not res.ok
    assert "order_date" in res.error
    assert ctx.queries["q1"].ok is False


def test_run_sql_blocks_writes(ctx: RunContext) -> None:
    res = call(ctx, "run_sql", sql="DROP TABLE orders", purpose="evil")
    assert not res.ok
    assert res.data["blocked"] is True


def test_injected_text_cannot_close_the_data_fence(ctx: RunContext) -> None:
    res = call(
        ctx,
        "run_sql",
        sql="SELECT review_comment_message FROM order_reviews WHERE review_id = 'injtest-0005'",
        purpose="read injection fixture",
    )
    assert res.ok
    body = res.content
    # The fixture contains "</data>" but the real fence uses a random id it cannot know.
    assert body.count(f"<<<END DATA id={ctx.nonce}>>>") == 1
    assert body.index("developer") < body.index(f"<<<END DATA id={ctx.nonce}>>>")


def test_make_chart_produces_vega_lite(ctx: RunContext) -> None:
    call(
        ctx,
        "run_sql",
        sql="SELECT strftime(order_purchase_timestamp, '%Y-%m') AS month, COUNT(*) AS orders "
        "FROM orders WHERE order_purchase_timestamp >= '2018-01-01' GROUP BY 1 ORDER BY 1",
        purpose="orders per month",
    )
    res = call(
        ctx, "make_chart", source_id="q1", mark="line", x="month", y="orders", title="Orders"
    )
    assert res.ok
    spec = ctx.charts["c1"].spec
    assert spec["$schema"].endswith("vega-lite/v6.json")
    assert spec["encoding"]["x"]["type"] == "temporal"
    assert len(spec["data"]["values"]) >= 8


def test_make_chart_rejects_unknown_columns(ctx: RunContext) -> None:
    call(ctx, "run_sql", sql="SELECT 1 AS a, 2 AS b", purpose="t")
    res = call(ctx, "make_chart", source_id="q1", mark="bar", x="a", y="zzz", title="t")
    assert not res.ok


def test_ask_user_is_terminal(ctx: RunContext) -> None:
    res = call(
        ctx,
        "ask_user",
        question="Revenue or orders?",
        options=["Revenue", "Orders"],
        reason="metric",
    )
    assert res.ok and res.terminal


def test_final_answer_grounding_accepts_cited_numbers(ctx: RunContext) -> None:
    call(ctx, "run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="count")
    res = call(
        ctx,
        "final_answer",
        status="answered",
        answer="There are [n1] orders.",
        citations=[{"id": "n1", "text": "99,441", "value": 99441, "source_id": "q1"}],
        result_query_id="q1",
    )
    assert res.ok and res.terminal
    assert res.data["unverified"] == []


def test_final_answer_rejects_invented_numbers_then_accepts_flagged(ctx: RunContext) -> None:
    call(ctx, "run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="count")
    bad = {
        "status": "answered",
        "answer": "There are [n1] orders, up 12.5% on last year.",
        "citations": [{"id": "n1", "text": "120,000", "value": 120000, "source_id": "q1"}],
        "result_query_id": "q1",
    }
    first = call(ctx, "final_answer", **bad)
    assert not first.ok
    assert "does not appear in q1" in first.error
    assert "uncited numbers" in first.error
    call(ctx, "final_answer", **bad)
    third = call(ctx, "final_answer", **bad)
    assert third.ok and third.terminal
    assert third.data["unverified"]


def test_refusal_needs_no_citations(ctx: RunContext) -> None:
    res = call(ctx, "final_answer", status="refused", answer="I can only run read-only analysis.")
    assert res.ok and res.terminal


def test_value_matching_allows_rounding_and_percent() -> None:
    rows = [["a", 1258681.34], ["b", 0.1834]]
    assert value_in_result(1258681.34, rows, 2)
    assert value_in_result(1258700, rows, 2)  # rounded for display
    assert value_in_result(18.34, rows, 2)  # share shown as a percentage
    assert value_in_result(2, rows, 2)  # row count
    assert not value_in_result(1300000, rows, 2)


def test_figure_written_next_to_its_marker_is_folded(ctx: RunContext) -> None:
    call(ctx, "run_sql", sql="SELECT 2960471.25 AS revenue, 0.184 AS share", purpose="t")
    res = call(
        ctx,
        "final_answer",
        answer="SP had R$ 2,960,471.25 [n1], a 18.4% [n2] share.",
        citations=[
            {"id": "n1", "text": "R$ 2.96M", "value": 2960471.25, "source_id": "q1"},
            {"id": "n2", "text": "18.4%", "value": 0.184, "source_id": "q1"},
        ],
        result_query_id="q1",
    )
    assert res.ok and res.data["unverified"] == []
    assert res.data["answer"] == "SP had [n1], a [n2] share."


def test_figure_that_disagrees_with_its_citation_is_rejected(ctx: RunContext) -> None:
    call(ctx, "run_sql", sql="SELECT 2960471.25 AS revenue", purpose="t")
    res = call(
        ctx,
        "final_answer",
        answer="SP had R$ 3,500,000 [n1].",
        citations=[{"id": "n1", "text": "R$ 2.96M", "value": 2960471.25, "source_id": "q1"}],
        result_query_id="q1",
    )
    assert not res.ok
    assert "does not match its cited value" in res.error
