"""HTTP API. The agent's events stream to the browser over Server-Sent Events.

POST /api/chat            {"message": "...", "session_id": "..."} -> text/event-stream
GET  /api/health          provider, model, sandbox status, rate-limit headroom
GET  /api/schema          tables and columns for the schema browser
GET  /api/sessions/{id}   conversation turns
GET  /api/traces          recent runs;  GET /api/traces/{run_id}  one full trace
GET  /api/evals           agent vs baseline results from evals/results
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from quarry.agent import events as ev
from quarry.agent.loop import Agent
from quarry.agent.memory import Session, SessionStore
from quarry.agent.trace import TraceRecorder, list_traces, load_trace
from quarry.api.ratelimit import RateLimiter
from quarry.config import ROOT, get_settings
from quarry.data.schema import GLOSSARY, TABLES
from quarry.evals.report import load_records, summarize_run
from quarry.evals.runner import RESULTS
from quarry.llm.base import LLMProvider
from quarry.llm.factory import get_provider
from quarry.tools.analysis import RunPythonTool
from quarry.tools.db import get_database

settings = get_settings()
app = FastAPI(title="Quarry API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
sessions = SessionStore()
limiter = RateLimiter(settings.rate_limit_per_ip_hour, settings.rate_limit_global_day)
_session_locks: dict[str, threading.Lock] = {}

EXAMPLES = [
    "Which product categories grew fastest last quarter, and why?",
    "What was revenue in each month from January to August 2018?",
    "Which 5 customer states have the highest share of late deliveries?",
    "How does the average review score differ for late and on-time deliveries?",
    "Who are our best customers?",
]


@lru_cache(maxsize=1)
def provider() -> LLMProvider:
    return get_provider(settings)


def agent() -> Agent:
    return Agent(
        provider(), get_database(str(settings.db_path), settings.duckdb_memory_limit), settings
    )


def client_ip(request: Request) -> str:
    # Behind a proxy (Hugging Face Spaces, Render) the client is the first forwarded hop.
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    session_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    # Serverless hosts do not share memory between instances, so the client may carry the
    # conversation itself. It only ever reaches the model as user-role context.
    session: Session | None = None

    @field_validator("session")
    @classmethod
    def _small_session(cls, v: Session | None) -> Session | None:
        if v is not None and (len(v.model_dump_json()) > 64_000 or len(v.turns) > 50):
            raise ValueError("session is too large; start a new conversation")
        return v


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.post("/api/chat")
def chat(body: ChatRequest, request: Request) -> StreamingResponse:
    decision = limiter.check(client_ip(request))
    if not decision.allowed:
        return JSONResponse(  # type: ignore[return-value]
            status_code=429,
            content={"error": decision.reason, "retry_after_s": decision.retry_after_s},
            headers={"Retry-After": str(decision.retry_after_s)},
        )
    if not limiter.slots.acquire(blocking=False):
        return JSONResponse(  # type: ignore[return-value]
            status_code=429,
            content={"error": "busy", "retry_after_s": 20},
            headers={"Retry-After": "20"},
        )

    if body.session is not None:
        session = body.session
        sessions.sessions[session.id] = session
    else:
        session = sessions.get_or_create(body.session_id)
    lock = _session_locks.setdefault(session.id, threading.Lock())

    def stream() -> Iterator[str]:
        try:
            with lock:  # one run at a time per conversation keeps memory consistent
                yield _sse(
                    "session", {"session_id": session.id, "remaining_hour": decision.remaining_hour}
                )
                recorder = TraceRecorder(settings.trace_dir, {"source": "api"})
                for event in recorder.record(agent().run(body.message, session)):
                    yield _sse(event.type, event.to_json_dict())
                yield _sse("session_state", session.model_dump())
        except Exception as exc:  # e.g. a missing API key: still end the stream cleanly
            yield _sse(ev.ERROR, {"type": ev.ERROR, "data": {"message": str(exc), "kind": "setup"}})
        finally:
            limiter.slots.release()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/health")
def health(request: Request) -> dict[str, Any]:
    python_ok, isolation = RunPythonTool.available()
    model = settings.model
    try:
        p = provider()
        model, name, ready = p.model, p.name, True
    except Exception as exc:
        name, ready = settings.provider, False
        isolation_note = str(exc)
        return {"ok": False, "provider": name, "model": model, "error": isolation_note}
    return {
        "ok": ready,
        "provider": name,
        "model": model,
        "python_sandbox": {
            "enabled": settings.python_enabled and python_ok,
            "isolation": isolation,
        },
        "rate_limit": limiter.status(client_ip(request)),
        "limits": {
            "max_steps": settings.max_steps,
            "sql_row_limit": settings.sql_row_limit,
            "sql_timeout_s": settings.sql_timeout_s,
        },
    }


@app.get("/api/schema")
def schema() -> dict[str, Any]:
    db = get_database(str(settings.db_path), settings.duckdb_memory_limit)
    cur = db.cursor()
    counts = {t.name: cur.execute(f'SELECT COUNT(*) FROM "{t.name}"').fetchone()[0] for t in TABLES}  # type: ignore[index]
    cur.close()
    return {
        "tables": [
            {
                "name": t.name,
                "description": t.comment,
                "rows": counts[t.name],
                "columns": [
                    {"name": c.name, "type": c.type, "description": c.comment} for c in t.columns
                ],
            }
            for t in TABLES
        ],
        "glossary": GLOSSARY,
        "examples": EXAMPLES,
    }


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    s = sessions.sessions.get(session_id)
    if s is None:
        raise HTTPException(404, "unknown session")
    return s.model_dump()


@app.get("/api/traces")
def traces(limit: int = 50) -> list[dict[str, Any]]:
    return list_traces(settings.trace_dir, min(limit, 200))


@app.get("/api/traces/{run_id}")
def trace(run_id: str) -> dict[str, Any]:
    t = load_trace(settings.trace_dir, run_id)
    if t is None:
        raise HTTPException(404, "unknown run")
    return t


@app.get("/api/evals")
def evals() -> list[dict[str, Any]]:
    out = []
    if not RESULTS.exists():
        return out
    for run_dir in sorted(RESULTS.iterdir()):
        if (
            not run_dir.is_dir()
            or run_dir.name in ("offline-smoke",)
            or run_dir.name.startswith("pilot")
        ):
            continue
        meta_path = run_dir / "meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"run": run_dir.name}
        items = {
            system: [
                {
                    k: r.get(k)
                    for k in (
                        "id",
                        "category",
                        "expect",
                        "question",
                        "outcome",
                        "success",
                        "failure",
                        "steps",
                        "latency_ms",
                        "exec_match",
                        "match_reason",
                        "sql",
                        "answer",
                    )
                }
                for r in load_records(run_dir / f"{system}.jsonl")
            ]
            for system in ("agent", "baseline")
        }
        out.append({"meta": meta, "summary": summarize_run(run_dir), "items": items})
    return out


# Serve the static UI build (next export) from the same origin when it exists, so the
# hosted demo is one container and the browser never needs CORS.
_web = ROOT / "web" / "out"
if Path(_web).exists():
    app.mount("/", StaticFiles(directory=_web, html=True), name="web")
