"""Integration tests for the hand-built loop, driven by a scripted fake LLM (no network)."""

from __future__ import annotations

import json

from quarry.agent import events as ev
from quarry.agent.loop import Agent
from quarry.agent.memory import Session
from quarry.agent.trace import TraceRecorder, load_trace
from quarry.config import Settings
from quarry.llm.base import Message
from quarry.llm.fake import FakeProvider, call, text
from quarry.tools.db import Database
from quarry.tools.registry import ToolRegistry

PLAN = text(json.dumps({"steps": ["Describe orders", "Count orders", "Answer"]}))


def run(agent: Agent, message: str, session: Session | None = None) -> list[ev.Event]:
    return list(agent.run(message, session))


def types(events: list[ev.Event]) -> list[str]:
    return [e.type for e in events]


def make_agent(script, db: Database, settings: Settings, **overrides) -> Agent:
    s = settings.model_copy(update=overrides)
    return Agent(FakeProvider(script), db, s, registry=ToolRegistry.default(python_enabled=False))


def final_answer(**kw):
    base = {
        "status": "answered",
        "answer": "There are [n1] orders.",
        "result_query_id": "q1",
        "citations": [{"id": "n1", "text": "99,441", "value": 99441, "source_id": "q1"}],
    }
    base.update(kw)
    return call("final_answer", **base)


def test_happy_path_plans_acts_and_answers(db: Database, settings: Settings) -> None:
    agent = make_agent(
        [
            PLAN,
            call("describe_table", table="orders"),
            call("run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="count orders"),
            final_answer(),
        ],
        db,
        settings,
    )
    events = run(agent, "How many orders are there?")
    t = types(events)
    assert t[0] == ev.RUN_STARTED and t[-1] == ev.RUN_FINISHED
    assert ev.PLAN in t and ev.FINAL in t
    final = next(e for e in events if e.type == ev.FINAL)
    assert final.data["sources"]["q1"]["sql"] == "SELECT COUNT(*) AS n FROM orders"
    done = events[-1].data
    assert done["status"] == "answered"
    assert done["llm_calls"] == 4
    assert done["total_tokens"] > 0


def test_recovers_from_sql_error(db: Database, settings: Settings) -> None:
    agent = make_agent(
        [
            PLAN,
            call("run_sql", sql="SELECT COUNT(*) AS n FROM order", purpose="typo"),
            call("run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="fixed"),
            final_answer(
                result_query_id="q2",
                citations=[{"id": "n1", "text": "99,441", "value": 99441, "source_id": "q2"}],
            ),
        ],
        db,
        settings,
    )
    events = run(agent, "How many orders?")
    reflections = [e for e in events if e.type == ev.REFLECTION]
    assert reflections and reflections[0].data["kind"] == "tool_error"
    assert events[-1].data["status"] == "answered"
    assert events[-1].data["recovered"] is True


def test_error_message_reaches_the_model_with_reflection_prompt(
    db: Database, settings: Settings
) -> None:
    provider = FakeProvider(
        [
            PLAN,
            call("run_sql", sql="SELECT order_date FROM orders", purpose="bad column"),
            call("run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="fixed"),
            final_answer(
                result_query_id="q2",
                citations=[{"id": "n1", "text": "99,441", "value": 99441, "source_id": "q2"}],
            ),
        ]
    )
    agent = Agent(provider, db, settings, registry=ToolRegistry.default(python_enabled=False))
    run(agent, "How many orders?")
    third_call_messages: list[Message] = provider.calls[2]["messages"]
    tool_msg = third_call_messages[-1]
    assert tool_msg.role == "tool"
    assert "order_date" in tool_msg.content
    assert "Reflect before retrying" in tool_msg.content


def test_identical_repeated_failure_stops_cleanly(db: Database, settings: Settings) -> None:
    bad = call("run_sql", sql="SELECT nope FROM orders", purpose="bad")
    agent = make_agent([PLAN, bad, bad, final_answer()], db, settings)
    events = run(agent, "How many orders?")
    assert events[-1].data["status"] == "stopped"
    err = next(e for e in events if e.type == ev.ERROR)
    assert err.data["kind"] == "repeat_failure"


def test_step_budget_forces_a_final_answer(db: Database, settings: Settings) -> None:
    looping = [call("describe_table", table="orders") for _ in range(3)]
    provider = FakeProvider(
        [
            PLAN,
            *looping,
            final_answer(citations=[], answer="Not enough data.", result_query_id=None),
        ]
    )
    agent = Agent(
        provider,
        db,
        settings.model_copy(update={"max_steps": 3}),
        registry=ToolRegistry.default(python_enabled=False),
    )
    events = run(agent, "How many orders?")
    assert provider.calls[-1]["tool_choice"] == "final_answer"
    assert any(e.type == ev.REFLECTION and e.data["kind"] == "budget" for e in events)
    assert events[-1].data["status"] == "answered"


def test_model_that_stops_calling_tools_is_nudged_then_stopped(
    db: Database, settings: Settings
) -> None:
    agent = make_agent([PLAN, text("hmm"), text("still thinking"), text("done?")], db, settings)
    events = run(agent, "How many orders?")
    assert (
        sum(1 for e in events if e.type == ev.REFLECTION and e.data["kind"] == "no_tool_call") == 2
    )
    assert events[-1].data["status"] == "stopped"


def test_clarification_ends_run_and_folds_into_next_question(
    db: Database, settings: Settings
) -> None:
    session = Session()
    ask = call(
        "ask_user",
        question="Revenue or order count?",
        options=["Revenue", "Order count"],
        reason="metric",
    )
    agent = make_agent([PLAN, ask], db, settings)
    events = run(agent, "Which state is the best?", session)
    assert events[-1].data["status"] == "clarify"
    assert session.pending_clarification is not None
    assert "Revenue or order count?" in session.effective_question("Revenue")

    provider = FakeProvider(
        [
            PLAN,
            call("run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="count"),
            final_answer(),
        ]
    )
    agent2 = Agent(provider, db, settings, registry=ToolRegistry.default(python_enabled=False))
    events2 = run(agent2, "Revenue", session)
    started = events2[0].data
    assert "Which state is the best?" in started["question"]
    assert "The user answered: Revenue" in started["question"]


def test_follow_up_sees_previous_sql_in_memory(db: Database, settings: Settings) -> None:
    session = Session()
    agent = make_agent(
        [
            PLAN,
            call("run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="count orders"),
            final_answer(),
        ],
        db,
        settings,
    )
    run(agent, "How many orders?", session)
    provider = FakeProvider(
        [PLAN, final_answer(status="refused", answer="x", citations=[], result_query_id=None)]
    )
    agent2 = Agent(provider, db, settings, registry=ToolRegistry.default(python_enabled=False))
    run(agent2, "Now only delivered ones", session)
    system = provider.calls[1]["messages"][0].content
    assert "Conversation so far" in system
    assert "SELECT COUNT(*) AS n FROM orders" in system


def test_refusal(db: Database, settings: Settings) -> None:
    agent = make_agent(
        [PLAN, call("final_answer", status="refused", answer="I can only analyse data read-only.")],
        db,
        settings,
    )
    events = run(agent, "Delete the orders table")
    assert events[-1].data["status"] == "refused"


def test_trace_is_written_with_every_event(db: Database, settings: Settings, tmp_path) -> None:
    agent = make_agent(
        [
            PLAN,
            call("run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="count"),
            final_answer(),
        ],
        db,
        settings,
    )
    rec = TraceRecorder(tmp_path)
    events = list(rec.record(agent.run("How many orders?")))
    trace = load_trace(tmp_path, events[0].run_id)
    assert trace is not None
    assert trace["summary"]["status"] == "answered"
    assert [e["type"] for e in trace["events"]] == types(events)
    sql_result = next(
        e for e in trace["events"] if e["type"] == ev.TOOL_RESULT and e["data"]["tool"] == "run_sql"
    )
    assert sql_result["data"]["data"]["rows"] == [[99441]]


def test_provider_failure_still_finishes_the_stream(db: Database, settings: Settings) -> None:
    def boom(messages, tools, schema):
        from quarry.llm.base import ProviderError

        raise ProviderError("quota exhausted")

    agent = Agent(
        FakeProvider(boom), db, settings, registry=ToolRegistry.default(python_enabled=False)
    )
    events = run(agent, "How many orders?")
    assert events[-1].type == ev.RUN_FINISHED
    assert events[-1].data["status"] == "error"
    assert any(e.type == ev.ERROR and "quota" in e.data["message"] for e in events)


def test_in_run_compaction_elides_old_results(db: Database, settings: Settings) -> None:
    big = [
        call(
            "run_sql",
            sql=f"SELECT order_id, customer_id, order_status FROM orders LIMIT 25 OFFSET {i}",
            purpose="rows",
        )
        for i in range(6)
    ]
    agent = make_agent(
        [PLAN, *big, final_answer(citations=[], answer="ok", result_query_id=None)],
        db,
        settings,
        context_token_limit=1500,
    )
    events = run(agent, "Show orders")
    assert any(e.type == ev.REFLECTION and e.data["kind"] == "compaction" for e in events)
