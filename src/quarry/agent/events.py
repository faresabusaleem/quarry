"""Events emitted by a run. The same stream feeds the live UI (SSE), the trace file and the evals."""

from __future__ import annotations

import time
from typing import Any

from pydantic import BaseModel, Field

from quarry.tools.db import to_jsonable


class Event(BaseModel):
    type: str
    run_id: str
    ts: float = Field(default_factory=time.time)
    step: int | None = None
    data: dict[str, Any] = Field(default_factory=dict)

    def to_json_dict(self) -> dict[str, Any]:
        out = self.model_dump()
        out["data"] = to_jsonable(self.data)
        return out


# Event types, in the order they usually appear:
RUN_STARTED = "run_started"
PLAN = "plan"
LLM_CALL = "llm_call"
NOTE = "assistant_note"  # text the model wrote next to its tool calls
TOOL_CALL = "tool_call"
TOOL_RESULT = "tool_result"
REFLECTION = "reflection"  # the loop telling the model what went wrong and to fix it
WAITING = "waiting"  # rate-limit pause
CLARIFICATION = "clarification"
FINAL = "final"
ERROR = "error"
RUN_FINISHED = "run_finished"
