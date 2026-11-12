from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from quarry.api import app as app_module
from quarry.api.ratelimit import RateLimiter
from quarry.llm.fake import FakeProvider, call, text

PLAN = text(json.dumps({"steps": ["Count orders", "Answer"]}))


def scripted():
    return FakeProvider(
        [
            PLAN,
            call("run_sql", sql="SELECT COUNT(*) AS n FROM orders", purpose="count orders"),
            call(
                "final_answer",
                answer="There are [n1] orders.",
                citations=[{"id": "n1", "text": "99,441", "value": 99441, "source_id": "q1"}],
                result_query_id="q1",
            ),
        ]
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path, db) -> TestClient:
    fake = scripted()
    monkeypatch.setattr(app_module, "provider", lambda: fake)
    monkeypatch.setattr(app_module.settings, "trace_dir", tmp_path)
    monkeypatch.setattr(app_module, "limiter", RateLimiter(per_ip_hour=5, global_day=50))
    return TestClient(app_module.app)


def parse_sse(body: str) -> list[tuple[str, dict]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_chat_streams_events_and_saves_a_trace(client: TestClient, tmp_path) -> None:
    r = client.post("/api/chat", json={"message": "How many orders are there?"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(r.text)
    names = [e for e, _ in events]
    assert names[0] == "session"
    assert "plan" in names and "tool_call" in names and "final" in names
    assert names[-1] == "run_finished"
    final = next(d for e, d in events if e == "final")["data"]
    assert final["sources"]["q1"]["rows"] == [[99441]]

    run_id = events[-1][1]["run_id"]
    listed = client.get("/api/traces").json()
    assert listed[0]["run_id"] == run_id
    full = client.get(f"/api/traces/{run_id}").json()
    assert full["summary"]["status"] == "answered"


def test_session_memory_survives_between_requests(client: TestClient, monkeypatch) -> None:
    first = parse_sse(client.post("/api/chat", json={"message": "How many orders?"}).text)
    sid = first[0][1]["session_id"]
    monkeypatch.setattr(app_module, "provider", scripted)
    second = parse_sse(
        client.post("/api/chat", json={"message": "And delivered?", "session_id": sid}).text
    )
    assert second[0][1]["session_id"] == sid
    turns = client.get(f"/api/sessions/{sid}").json()["turns"]
    assert [t["question"] for t in turns] == ["How many orders?", "And delivered?"]


def test_rate_limit_returns_429_with_retry_after(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(app_module, "limiter", RateLimiter(per_ip_hour=1, global_day=50))
    assert client.post("/api/chat", json={"message": "How many orders?"}).status_code == 200
    r = client.post("/api/chat", json={"message": "again"})
    assert r.status_code == 429
    assert r.json()["error"] == "hourly_limit"
    assert int(r.headers["retry-after"]) > 0


def test_global_daily_cap_applies_across_ips() -> None:
    lim = RateLimiter(per_ip_hour=10, global_day=2)
    assert lim.check("1.1.1.1", now=0).allowed
    assert lim.check("2.2.2.2", now=1).allowed
    d = lim.check("3.3.3.3", now=2)
    assert not d.allowed and d.reason == "daily_limit"
    assert lim.check("4.4.4.4", now=86_401).allowed


def test_input_validation(client: TestClient) -> None:
    assert client.post("/api/chat", json={"message": ""}).status_code == 422
    assert client.post("/api/chat", json={"message": "x" * 1001}).status_code == 422
    assert (
        client.post("/api/chat", json={"message": "hi", "session_id": "../etc"}).status_code == 422
    )


def test_health_and_schema(client: TestClient) -> None:
    h = client.get("/api/health").json()
    assert h["ok"] and h["provider"] == "fake"
    s = client.get("/api/schema").json()
    orders = next(t for t in s["tables"] if t["name"] == "orders")
    assert orders["rows"] == 99441
    assert s["examples"]


def test_unknown_trace_is_404(client: TestClient) -> None:
    assert client.get("/api/traces/nope").status_code == 404
    assert client.get("/api/traces/..%2Fetc").status_code == 404
