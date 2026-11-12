"""The baseline: single-shot text-to-SQL. One LLM call, no tools, no retries.

It gets everything the agent's prompts contain and more: the full schema with every column
comment up front, the same glossary, and the option to ask for clarification or refuse. What
it does not get is a loop: it cannot look at data, see an error, or check its answer.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

import duckdb

from quarry.config import Settings
from quarry.data.schema import GLOSSARY, TABLES
from quarry.llm.base import LLMProvider, Message, ProviderError, Usage
from quarry.llm.factory import paid_equivalent_usd
from quarry.tools.db import Database, execute_with_limits
from quarry.tools.sql_guard import check_sql


def schema_ddl() -> str:
    blocks = []
    for t in TABLES:
        cols = ",\n".join(f"  {c.name} {c.type}  -- {c.comment}" for c in t.columns)
        blocks.append(f"-- {t.comment}\nCREATE TABLE {t.name} (\n{cols}\n);")
    return "\n\n".join(blocks)


BASELINE_PROMPT = f"""\
You translate business questions about the Olist Brazilian e-commerce marketplace into one
DuckDB SQL query over the schema below. The database is read-only.

Reply with a JSON object:
- {{"action": "sql", "sql": "<one SELECT query whose result answers the question>"}}
  The rows must be exactly the answer: one row for "which X is the most ...", N rows for
  "top N", one row per period for "each month", only for the period asked.
- {{"action": "clarify", "message": "<question>"}} if the question has several reasonable
  meanings that the glossary does not settle;
- {{"action": "refuse", "message": "<reason>"}} if the request is out of scope or unsafe
  (changing data, sending messages, files, unrelated topics, identifying individuals).

## Schema
{schema_ddl()}

## Business glossary
{GLOSSARY}
"""

BASELINE_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["sql", "clarify", "refuse"]},
        "sql": {"type": "string"},
        "message": {"type": "string"},
    },
    "required": ["action"],
}


@dataclass
class BaselineResult:
    action: str  # sql | clarify | refuse | invalid
    sql: str | None = None
    message: str | None = None
    ok: bool = False
    columns: list[str] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    error: str | None = None
    blocked: bool = False
    usage: Usage = field(default_factory=Usage)
    cost_usd: float = 0.0
    latency_ms: float = 0.0


def _parse(content: str) -> dict[str, Any]:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
    match = re.search(r"\{.*\}", text, re.S)
    return json.loads(match.group(0) if match else text)


def run_baseline(
    provider: LLMProvider,
    db: Database,
    settings: Settings,
    question: str,
    history: list[tuple[str, str | None]] | None = None,
) -> BaselineResult:
    """history: earlier (question, sql) pairs of the same conversation."""
    convo = ""
    if history:
        convo = "\n\n## Conversation so far\n" + "\n".join(
            f"User: {q}\nYour SQL: {s or '(none)'}" for q, s in history
        )
    started = time.perf_counter()
    try:
        resp = provider.chat(
            [
                Message(role="system", content=BASELINE_PROMPT + convo),
                Message(role="user", content=question),
            ],
            json_schema=BASELINE_SCHEMA,
        )
    except ProviderError as exc:
        return BaselineResult(action="invalid", error=f"provider error: {exc}")
    out = BaselineResult(
        action="invalid",
        usage=resp.usage,
        cost_usd=paid_equivalent_usd(resp.model or provider.model, resp.usage),
    )
    try:
        data = _parse(resp.message.content)
        out.action = str(data.get("action", "invalid"))
        out.sql = data.get("sql")
        out.message = data.get("message")
    except (json.JSONDecodeError, AttributeError) as exc:
        out.error = f"could not parse model output: {exc}"
        out.latency_ms = (time.perf_counter() - started) * 1000
        return out

    if out.action == "sql":
        sql = re.sub(r";\s*$", "", (out.sql or "").strip())
        out.sql = sql
        guard = check_sql(sql, db.tables())
        if not guard.ok:
            out.blocked = True
            out.error = f"blocked: {guard.reason}"
        else:
            try:
                res = execute_with_limits(
                    db.cursor(),
                    sql,
                    max_rows=settings.sql_row_limit,
                    timeout_s=settings.sql_timeout_s,
                )
                out.ok, out.columns, out.rows = True, res.columns, res.rows
            except (duckdb.Error, TimeoutError) as exc:
                out.error = str(exc).splitlines()[0][:300]
    out.latency_ms = (time.perf_counter() - started) * 1000
    return out
