"""Oracle fakes for the offline eval smoke test.

They answer every item with its gold SQL through the real agent loop and the real baseline
code path, so CI checks the whole harness (loop, tools, scoring, report) without an API key.
A perfect oracle should score 100%; anything less is a bug in the harness, not the model.
"""

from __future__ import annotations

import json
from typing import Any

from quarry.evals.benchmark import Item, load_gold
from quarry.llm.base import Message
from quarry.llm.fake import FakeProvider, call, text
from quarry.tools.base import ToolSpec

_FREEFORM_SQL = (
    "SELECT review_score, review_comment_message FROM order_reviews "
    "WHERE review_creation_date >= '2018-09-01'"
)


def _item_for(messages: list[Message], items: list[Item]) -> Item | None:
    user = next((m.content for m in messages if m.role == "user"), "")
    for item in items:
        if user.startswith(item.question):
            return item
    return None


def _first_number(rows: list[list[Any]]) -> float | None:
    for row in rows:
        for v in row:
            if isinstance(v, int | float) and not isinstance(v, bool):
                return float(v)
    return None


def oracle_provider(items: list[Item]) -> FakeProvider:
    gold = load_gold()

    def script(
        messages: list[Message], tools: list[ToolSpec] | None, schema: dict[str, Any] | None
    ) -> Message:
        if schema is not None:
            return text(json.dumps({"steps": ["Run the gold query", "Answer"]}))
        item = _item_for(messages, items)
        ran_sql = any(m.role == "tool" and m.name == "run_sql" for m in messages)
        if item is None:  # an unscored context turn of a follow-up
            if not ran_sql:
                return call("run_sql", sql="SELECT 1 AS one", purpose="context turn")
            return call("final_answer", status="answered", answer="Done.", result_query_id="q1")
        if item.expect == "clarify":
            return call(
                "ask_user",
                question="Which metric do you mean?",
                options=["Revenue", "Orders"],
                reason="ambiguous",
            )
        if item.expect == "refuse":
            return call("final_answer", status="refused", answer="That is outside what I can do.")
        if not ran_sql:
            return call("run_sql", sql=item.gold_sql or _FREEFORM_SQL, purpose="gold query")
        g = gold.get(item.id)
        value = _first_number(g.rows) if g else None
        if value is None:
            return call(
                "final_answer",
                status="answered",
                answer="See the result table.",
                result_query_id="q1",
            )
        return call(
            "final_answer",
            status="answered",
            answer="The answer is [n1].",
            citations=[{"id": "n1", "text": f"{value:g}", "value": value, "source_id": "q1"}],
            result_query_id="q1",
        )

    return FakeProvider(script, model="oracle")


def oracle_baseline_provider(items: list[Item]) -> FakeProvider:
    def script(
        messages: list[Message], tools: list[ToolSpec] | None, schema: dict[str, Any] | None
    ) -> Message:
        user = next((m.content for m in messages if m.role == "user"), "")
        item = next((i for i in items if i.question == user), None)
        if item is None:
            return text(json.dumps({"action": "sql", "sql": "SELECT 1"}))
        if item.expect == "clarify":
            return text(json.dumps({"action": "clarify", "message": "Which metric?"}))
        if item.expect == "refuse":
            return text(json.dumps({"action": "refuse", "message": "Out of scope."}))
        return text(json.dumps({"action": "sql", "sql": item.gold_sql or _FREEFORM_SQL}))

    return FakeProvider(script, model="oracle")
