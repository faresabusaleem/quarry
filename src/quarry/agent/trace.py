"""Persist every run as a JSON trace: plan, each LLM and tool call, results, errors, cost."""

from __future__ import annotations

import json
import time
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from quarry.agent import events as ev
from quarry.agent.events import Event


class TraceRecorder:
    """Wraps an event stream, passes every event through, and writes the trace at the end."""

    def __init__(self, trace_dir: Path, meta: dict[str, Any] | None = None):
        self.trace_dir = trace_dir
        self.meta = meta or {}
        self.events: list[dict[str, Any]] = []
        self.path: Path | None = None

    def record(self, stream: Iterable[Event]) -> Iterator[Event]:
        try:
            for event in stream:
                self.events.append(event.to_json_dict())
                yield event
        finally:
            self.write()

    def write(self) -> Path | None:
        if not self.events:
            return None
        run_id = self.events[0]["run_id"]
        start = next((e for e in self.events if e["type"] == ev.RUN_STARTED), self.events[0])
        end = next((e for e in reversed(self.events) if e["type"] == ev.RUN_FINISHED), None)
        summary = {
            "run_id": run_id,
            "created": start["ts"],
            "question": start["data"].get("question"),
            "message": start["data"].get("message"),
            "session_id": start["data"].get("session_id"),
            "provider": start["data"].get("provider"),
            "model": start["data"].get("model"),
            "status": end["data"]["status"] if end else "incomplete",
            "steps": end["data"]["steps"] if end else None,
            "total_tokens": end["data"]["total_tokens"] if end else None,
            "cost_usd": end["data"]["cost_usd"] if end else None,
            "latency_ms": end["data"]["latency_ms"] if end else None,
            **self.meta,
        }
        self.trace_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.trace_dir / f"{run_id}.json"
        self.path.write_text(json.dumps({"summary": summary, "events": self.events}, indent=1))
        return self.path


def list_traces(trace_dir: Path, limit: int = 100) -> list[dict[str, Any]]:
    files = sorted(trace_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    out = []
    for f in files[:limit]:
        try:
            out.append(json.loads(f.read_text())["summary"])
        except (json.JSONDecodeError, KeyError):
            continue
    return out


def load_trace(trace_dir: Path, run_id: str) -> dict[str, Any] | None:
    if not run_id.isalnum():
        return None
    path = trace_dir / f"{run_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def now() -> float:
    return time.time()
