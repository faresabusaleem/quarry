"""Provider wire formats, retries and pacing, tested against mocked HTTP (no real API calls)."""

from __future__ import annotations

import json

import httpx
import pytest

from quarry.llm import base
from quarry.llm.base import Message, RateLimitError, ToolCall
from quarry.llm.factory import paid_equivalent_usd
from quarry.llm.gemini import GeminiProvider
from quarry.llm.ollama import OllamaProvider
from quarry.tools.base import ToolSpec

TOOLS = [
    ToolSpec(
        name="run_sql",
        description="Run SQL",
        parameters={"type": "object", "properties": {"sql": {"type": "string"}}},
    )
]


def gemini_with(handler) -> GeminiProvider:
    return GeminiProvider(
        "test-key",
        "gemini-3.5-flash-lite",
        rpm=1000,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_gemini_request_shape_and_signature_replay() -> None:
    seen: list[dict] = []
    signed_steps = [
        {"type": "thought", "signature": "SIG_A"},
        {
            "type": "function_call",
            "id": "call_1",
            "name": "run_sql",
            "arguments": {"sql": "SELECT 1"},
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        assert request.headers["x-goog-api-key"] == "test-key"
        if len(seen) == 1:
            return httpx.Response(
                200,
                json={
                    "status": "requires_action",
                    "steps": signed_steps,
                    "usage": {
                        "total_input_tokens": 50,
                        "total_output_tokens": 10,
                        "total_thought_tokens": 5,
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "steps": [{"type": "model_output", "content": [{"type": "text", "text": "done"}]}],
                "usage": {"total_input_tokens": 80, "total_output_tokens": 3},
            },
        )

    p = gemini_with(handler)
    msgs = [Message(role="system", content="be careful"), Message(role="user", content="hi")]
    r1 = p.chat(msgs, TOOLS, tool_choice="required")
    assert r1.message.tool_calls == [
        ToolCall(id="call_1", name="run_sql", arguments={"sql": "SELECT 1"})
    ]
    assert r1.usage.thinking_tokens == 5
    body1 = seen[0]
    assert body1["store"] is False
    assert body1["system_instruction"] == "be careful"
    assert body1["input"] == [{"type": "user_input", "content": "hi"}]
    assert body1["tools"][0] == {
        "type": "function",
        "name": "run_sql",
        "description": "Run SQL",
        "parameters": TOOLS[0].parameters,
    }
    assert body1["generation_config"]["tool_choice"] == "any"

    msgs += [r1.message, Message(role="tool", content="1", tool_call_id="call_1", name="run_sql")]
    r2 = p.chat(msgs, TOOLS, tool_choice="final_answer")
    assert r2.message.content == "done"
    body2 = seen[1]
    # The thought signature must come back exactly as received.
    assert body2["input"][1:3] == signed_steps
    assert body2["input"][3] == {
        "type": "function_result",
        "name": "run_sql",
        "call_id": "call_1",
        "result": [{"type": "text", "text": "1"}],
    }
    assert body2["generation_config"]["tool_choice"] == {
        "allowed_tools": {"mode": "any", "tools": ["final_answer"]}
    }


def test_gemini_structured_output_request() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "steps": [
                    {
                        "type": "model_output",
                        "content": [{"type": "text", "text": '{"steps": ["a"]}'}],
                    }
                ]
            },
        )

    schema = {
        "type": "object",
        "properties": {"steps": {"type": "array", "items": {"type": "string"}}},
    }
    r = gemini_with(handler).chat([Message(role="user", content="plan")], json_schema=schema)
    assert json.loads(r.message.content) == {"steps": ["a"]}
    assert seen[0]["response_format"] == {
        "type": "text",
        "mime_type": "application/json",
        "schema": schema,
    }


def test_gemini_retries_429_with_server_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []
    monkeypatch.setattr(base.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(base.random, "uniform", lambda a, b: 0.1)
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] < 3:
            return httpx.Response(
                429,
                json={
                    "error": {
                        "code": 429,
                        "status": "RESOURCE_EXHAUSTED",
                        "details": [{"retryDelay": "7s"}],
                    }
                },
            )
        return httpx.Response(
            200,
            json={"steps": [{"type": "model_output", "content": [{"type": "text", "text": "ok"}]}]},
        )

    waits: list[tuple[float, str]] = []
    r = gemini_with(handler).chat(
        [Message(role="user", content="x")], on_wait=lambda s, why: waits.append((s, why))
    )
    assert r.message.content == "ok"
    assert r.retries == 2
    assert sleeps == [7.0, 7.0]
    assert waits == [(7.0, "rate_limited"), (7.0, "rate_limited")]


def test_gemini_gives_up_after_max_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(base.time, "sleep", lambda s: None)
    p = gemini_with(lambda r: httpx.Response(429, text="quota"))
    p.max_retries = 2
    with pytest.raises(RateLimitError):
        p.chat([Message(role="user", content="x")])


def test_pacer_spaces_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = {"t": 0.0}
    monkeypatch.setattr(base.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(base.time, "sleep", lambda s: clock.__setitem__("t", clock["t"] + s))
    pacer = base.RequestPacer(rpm=2)
    assert pacer.acquire() == 0
    assert pacer.acquire() == 0
    waited = pacer.acquire()
    assert waited == pytest.approx(60.05)


def test_ollama_wire_format_and_format_fallback() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        if "format" in body:
            return httpx.Response(501, json={"error": "structured output is unavailable"})
        return httpx.Response(
            200,
            json={
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"function": {"name": "run_sql", "arguments": {"sql": "SELECT 1"}}}
                    ],
                },
                "prompt_eval_count": 12,
                "eval_count": 4,
            },
        )

    p = OllamaProvider(client=httpx.Client(transport=httpx.MockTransport(handler)))
    r = p.chat([Message(role="user", content="hi")], TOOLS, json_schema={"type": "object"})
    assert r.message.tool_calls[0].name == "run_sql"
    assert r.usage.input_tokens == 12
    assert p.supports_format is False
    assert "JSON schema" in seen[-1]["messages"][-1]["content"]
    assert seen[-1]["options"]["temperature"] == 0


def test_ollama_forced_tool_offers_only_that_tool() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "x"}})

    tools = [*TOOLS, ToolSpec(name="final_answer", description="d", parameters={"type": "object"})]
    OllamaProvider(client=httpx.Client(transport=httpx.MockTransport(handler))).chat(
        [Message(role="user", content="hi")], tools, tool_choice="final_answer"
    )
    assert [t["function"]["name"] for t in seen[0]["tools"]] == ["final_answer"]


def test_paid_equivalent_pricing() -> None:
    usage = base.Usage(input_tokens=1_000_000, output_tokens=100_000, thinking_tokens=100_000)
    assert paid_equivalent_usd("gemini-3.5-flash-lite", usage) == pytest.approx(0.30 + 0.5)
    assert paid_equivalent_usd("qwen3.5:9b", usage) == 0.0
