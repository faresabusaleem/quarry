"""Gemini through the Interactions API (the default Gemini API since June 2026).

We use it in stateless mode (`store: false`) and send the full history each turn, because
the agent loop owns memory, compaction and traces; server-side state would hide that.

Gemini 3.x models attach thought signatures to their reasoning and function-call steps. In
stateless mode those steps must be sent back exactly as received, so the provider keeps the
raw response steps in `Message.provider_state` and replays them verbatim.

Reference: https://aistudio.google.com/docs/function-calling (Interactions API, REST tab).
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Literal

import httpx

from quarry.llm.base import (
    LLMProvider,
    LLMResponse,
    Message,
    ProviderError,
    RateLimitError,
    ToolCall,
    TransientError,
    Usage,
)
from quarry.tools.base import ToolSpec

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
API_REVISION = "2026-05-20"  # pins the request/response shape documented on that date


def _retry_after(response: httpx.Response) -> float | None:
    header = response.headers.get("retry-after")
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    # Google RPC errors carry RetryInfo, e.g. {"retryDelay": "17s"}.
    match = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', response.text)
    return float(match.group(1)) if match else None


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3.5-flash-lite",
        *,
        rpm: int = 10,
        thinking_level: str = "low",
        timeout_s: float = 120.0,
        client: httpx.Client | None = None,
    ):
        super().__init__(max_retries=6, rpm=rpm)
        if not api_key:
            raise ProviderError("GEMINI_API_KEY is not set; add it to .env")
        self.api_key = api_key
        self.model = model
        self.thinking_level = thinking_level
        self.client = client or httpx.Client(timeout=timeout_s)

    # ------------------------------------------------------------ wire format

    @staticmethod
    def _steps_for(m: Message) -> list[dict[str, Any]]:
        if m.role == "user":
            return [{"type": "user_input", "content": m.content}]
        if m.role == "tool":
            return [
                {
                    "type": "function_result",
                    "name": m.name,
                    "call_id": m.tool_call_id,
                    "result": [{"type": "text", "text": m.content}],
                }
            ]
        if m.role == "assistant":
            if m.provider_state:  # replay verbatim to keep thought signatures intact
                return list(m.provider_state)
            steps: list[dict[str, Any]] = []
            if m.content:
                steps.append(
                    {"type": "model_output", "content": [{"type": "text", "text": m.content}]}
                )
            steps += [
                {"type": "function_call", "id": c.id, "name": c.name, "arguments": c.arguments}
                for c in m.tool_calls
            ]
            return steps
        return []

    def build_request(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None,
        *,
        tool_choice: Literal["auto", "required"] | str,
        json_schema: dict[str, Any] | None,
    ) -> dict[str, Any]:
        system = "\n\n".join(m.content for m in messages if m.role == "system")
        steps = [s for m in messages if m.role != "system" for s in self._steps_for(m)]
        gen: dict[str, Any] = {
            "temperature": 0,
            "thinking_level": self.thinking_level,
            "max_output_tokens": 8192,
        }
        body: dict[str, Any] = {"model": self.model, "store": False, "input": steps}
        if system:
            body["system_instruction"] = system
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
                for t in tools
            ]
            if tool_choice == "required":
                gen["tool_choice"] = "any"
            elif tool_choice != "auto":
                gen["tool_choice"] = {"allowed_tools": {"mode": "any", "tools": [tool_choice]}}
        if json_schema is not None:
            body["response_format"] = {
                "type": "text",
                "mime_type": "application/json",
                "schema": json_schema,
            }
        body["generation_config"] = gen
        return body

    @staticmethod
    def parse_response(data: dict[str, Any], model: str) -> LLMResponse:
        steps = data.get("steps") or []
        text_parts: list[str] = []
        calls: list[ToolCall] = []
        for step in steps:
            kind = step.get("type")
            if kind == "model_output":
                text_parts += [
                    c.get("text", "") for c in step.get("content", []) if c.get("type") == "text"
                ]
            elif kind == "function_call":
                calls.append(
                    ToolCall(
                        id=step.get("id") or f"call_{uuid.uuid4().hex[:8]}",
                        name=step.get("name", ""),
                        arguments=step.get("arguments") or {},
                    )
                )
        usage = data.get("usage") or {}
        return LLMResponse(
            message=Message(
                role="assistant",
                content="".join(text_parts),
                tool_calls=calls,
                provider_state=steps,
            ),
            usage=Usage(
                input_tokens=int(usage.get("total_input_tokens") or 0),
                output_tokens=int(usage.get("total_output_tokens") or 0),
                thinking_tokens=int(usage.get("total_thought_tokens") or 0),
            ),
            model=data.get("model") or model,
        )

    def _chat(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None,
        *,
        tool_choice: Literal["auto", "required"] | str,
        json_schema: dict[str, Any] | None,
    ) -> LLMResponse:
        body = self.build_request(messages, tools, tool_choice=tool_choice, json_schema=json_schema)
        try:
            r = self.client.post(
                ENDPOINT,
                json=body,
                headers={"x-goog-api-key": self.api_key, "Api-Revision": API_REVISION},
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise TransientError(f"Gemini request failed: {exc}") from exc
        if r.status_code == 429:
            raise RateLimitError("Gemini rate limit (429)", retry_after=_retry_after(r))
        if r.status_code in (408, 500, 502, 503, 504):
            raise TransientError(f"Gemini {r.status_code}: {r.text[:300]}")
        if r.status_code != 200:
            raise ProviderError(f"Gemini {r.status_code}: {r.text[:500]}")
        return self.parse_response(r.json(), self.model)
