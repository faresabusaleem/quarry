"""Provider-neutral LLM interface.

The agent loop only ever talks to `LLMProvider.chat`. Each provider translates these
neutral messages to its own wire format, which keeps the loop identical for Gemini, a local
Ollama model, and the scripted fake used in tests.
"""

from __future__ import annotations

import random
import threading
import time
from abc import ABC, abstractmethod
from collections import deque
from typing import Any, Literal

from pydantic import BaseModel, Field

from quarry.tools.base import ToolSpec


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_call_id: str | None = None  # role == "tool"
    name: str | None = None  # tool name for role == "tool"
    # Opaque provider data that must be echoed back verbatim on the next request,
    # e.g. Gemini thought signatures. The loop stores it and never inspects it.
    provider_state: Any = None


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens + self.thinking_tokens

    def __add__(self, other: Usage) -> Usage:
        return Usage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            thinking_tokens=self.thinking_tokens + other.thinking_tokens,
        )


class LLMResponse(BaseModel):
    message: Message
    usage: Usage = Field(default_factory=Usage)
    latency_ms: float = 0.0
    model: str = ""
    retries: int = 0


class ProviderError(RuntimeError):
    """A provider call failed in a way retrying will not fix."""


class RateLimitError(ProviderError):
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class TransientError(ProviderError):
    """Timeouts, 5xx and similar: worth retrying."""


class LLMProvider(ABC):
    name: str
    model: str

    def __init__(self, *, max_retries: int = 5, rpm: int | None = None):
        self.max_retries = max_retries
        self._pacer = RequestPacer(rpm) if rpm else None

    @abstractmethod
    def _chat(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None,
        *,
        tool_choice: Literal["auto", "required"] | str,
        json_schema: dict[str, Any] | None,
    ) -> LLMResponse: ...

    def chat(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        *,
        tool_choice: Literal["auto", "required"] | str = "auto",
        json_schema: dict[str, Any] | None = None,
        on_wait: Any = None,
    ) -> LLMResponse:
        """Call the model, pacing requests and retrying 429/5xx with exponential backoff.

        `tool_choice` is "auto", "required" (must call some tool) or a tool name (must call
        that tool). `json_schema` asks for a JSON object matching the schema instead.
        `on_wait(seconds, reason)` lets the caller surface a rate-limit pause in the UI.
        """
        attempt = 0
        while True:
            if self._pacer:
                waited = self._pacer.acquire()
                if waited > 0.5 and on_wait:
                    on_wait(waited, "pacing")
            try:
                start = time.perf_counter()
                resp = self._chat(messages, tools, tool_choice=tool_choice, json_schema=json_schema)
                resp.latency_ms = (time.perf_counter() - start) * 1000
                resp.retries = attempt
                return resp
            except (RateLimitError, TransientError) as exc:
                attempt += 1
                if attempt > self.max_retries:
                    raise
                # Full-jitter backoff, but never shorter than what the server asked for.
                backoff = random.uniform(0, min(60.0, 2.0 * 2**attempt))
                server = getattr(exc, "retry_after", None) or 0.0
                delay = max(backoff, server)
                if on_wait:
                    on_wait(delay, "rate_limited" if isinstance(exc, RateLimitError) else "retry")
                time.sleep(delay)


class RequestPacer:
    """Client-side sliding-window limiter so we stay under a requests-per-minute quota.

    Free tiers reject bursts; spacing calls ourselves avoids most 429s and keeps the
    backoff path for the rare case where the server still says no.
    """

    def __init__(self, rpm: int):
        self.rpm = rpm
        self.calls: deque[float] = deque()
        self.lock = threading.Lock()

    def acquire(self) -> float:
        waited = 0.0
        while True:
            with self.lock:
                now = time.monotonic()
                while self.calls and now - self.calls[0] >= 60:
                    self.calls.popleft()
                if len(self.calls) < self.rpm:
                    self.calls.append(now)
                    return waited
                sleep_for = 60 - (now - self.calls[0]) + 0.05
            time.sleep(sleep_for)
            waited += sleep_for
