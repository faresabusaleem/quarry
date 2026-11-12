"""Short-term conversation memory.

A session keeps its turns. Each turn stores the question, the outcome, the answer text and
the SQL of the queries that mattered, because follow-ups ("now only for the top region")
almost always mean "change the last query". When the rendered memory grows past a budget,
older turns are folded into an LLM-written summary and only the recent turns stay verbatim.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from pydantic import BaseModel, Field

from quarry.agent.prompts import SUMMARIZE_PROMPT
from quarry.llm.base import LLMProvider, Message, Usage

KEEP_VERBATIM = 2


def estimate_tokens(text: str) -> int:
    # Roughly four characters per token for English and SQL; good enough for budgeting.
    return len(text) // 4 + 1


class TurnQuery(BaseModel):
    id: str
    purpose: str
    sql: str


class Turn(BaseModel):
    run_id: str
    question: str
    status: str = "running"
    answer: str | None = None
    clarification: dict[str, Any] | None = None
    queries: list[TurnQuery] = Field(default_factory=list)
    created: float = Field(default_factory=time.time)


class Session(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    turns: list[Turn] = Field(default_factory=list)
    summary: str = ""
    summarized_upto: int = 0  # turns[:summarized_upto] live only in `summary`

    @property
    def pending_clarification(self) -> Turn | None:
        if self.turns and self.turns[-1].status == "clarify":
            return self.turns[-1]
        return None

    def effective_question(self, message: str) -> str:
        """Fold a reply to a clarifying question back into the original question."""
        pending = self.pending_clarification
        if pending is None or pending.clarification is None:
            return message
        return (
            f"{pending.question}\n\n(You asked: {pending.clarification.get('question')} "
            f"The user answered: {message})"
        )

    def render(self) -> str:
        parts: list[str] = []
        if self.summary:
            parts.append(f"Earlier in this conversation: {self.summary}")
        for i, t in enumerate(self.turns[self.summarized_upto :], start=self.summarized_upto + 1):
            if t.status == "clarify":
                continue  # folded into the next question by effective_question
            line = f"Turn {i}. User: {t.question}\n  Outcome: {t.status}."
            if t.answer:
                line += f" Answer: {t.answer[:600]}"
            for q in t.queries[-2:]:
                line += f"\n  Query {q.id} ({q.purpose}): {q.sql}"
            parts.append(line)
        return "\n".join(parts)

    def compact(self, provider: LLMProvider, budget_tokens: int) -> Usage | None:
        """Summarise older turns if the rendered memory exceeds the budget."""
        if estimate_tokens(self.render()) <= budget_tokens:
            return None
        cutoff = max(self.summarized_upto, len(self.turns) - KEEP_VERBATIM)
        if cutoff <= self.summarized_upto:
            return None
        old = Session(
            turns=self.turns[:cutoff], summary=self.summary, summarized_upto=self.summarized_upto
        )
        resp = provider.chat(
            [
                Message(role="system", content=SUMMARIZE_PROMPT),
                Message(role="user", content=old.render()),
            ]
        )
        self.summary = resp.message.content.strip()
        self.summarized_upto = cutoff
        return resp.usage


class SessionStore:
    """In-memory sessions for the API. A restart forgets them, which is fine for a demo."""

    def __init__(self, max_sessions: int = 1_000):
        self.sessions: dict[str, Session] = {}
        self.max_sessions = max_sessions

    def get_or_create(self, session_id: str | None) -> Session:
        if session_id and session_id in self.sessions:
            return self.sessions[session_id]
        if len(self.sessions) >= self.max_sessions:
            oldest = min(
                self.sessions.values(), key=lambda s: s.turns[-1].created if s.turns else 0
            )
            self.sessions.pop(oldest.id, None)
        s = Session(id=session_id) if session_id else Session()
        self.sessions[s.id] = s
        return s
