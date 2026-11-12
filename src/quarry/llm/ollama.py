"""Local models through Ollama's /api/chat endpoint."""

from __future__ import annotations

import json
import uuid
from typing import Any, Literal

import httpx

from quarry.llm.base import (
    LLMProvider,
    LLMResponse,
    Message,
    ProviderError,
    ToolCall,
    TransientError,
    Usage,
)
from quarry.tools.base import ToolSpec


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(
        self,
        model: str = "qwen3.5:9b",
        host: str = "http://localhost:11434",
        *,
        think: bool = False,
        num_ctx: int = 32_768,
        timeout_s: float = 300.0,
        client: httpx.Client | None = None,
    ):
        super().__init__(max_retries=2)
        self.model = model
        self.host = host.rstrip("/")
        self.think = think
        self.num_ctx = num_ctx
        self.client = client or httpx.Client(timeout=timeout_s)
        # Some runners (e.g. MLX) reject `format`; we learn that once and fall back to
        # describing the schema in the prompt, which the planner parses leniently.
        self.supports_format = True

    def _to_wire(self, m: Message) -> dict[str, Any]:
        if m.role == "tool":
            return {"role": "tool", "content": m.content, "tool_name": m.name}
        out: dict[str, Any] = {"role": m.role, "content": m.content}
        if m.tool_calls:
            out["tool_calls"] = [
                {"function": {"name": c.name, "arguments": c.arguments}} for c in m.tool_calls
            ]
        return out

    def _chat(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None,
        *,
        tool_choice: Literal["auto", "required"] | str,
        json_schema: dict[str, Any] | None,
    ) -> LLMResponse:
        # Ollama has no tool_choice parameter. Forcing a specific tool is emulated by
        # offering only that tool; "required" is enforced by the agent loop's nudge.
        if tools and tool_choice not in ("auto", "required"):
            tools = [t for t in tools if t.name == tool_choice]
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [self._to_wire(m) for m in messages],
            "stream": False,
            "think": self.think,
            "options": {"temperature": 0, "num_ctx": self.num_ctx, "seed": 7},
        }
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ]
        if json_schema is not None and self.supports_format:
            body["format"] = json_schema
        elif json_schema is not None:
            body["messages"].append(
                {
                    "role": "system",
                    "content": "Reply with only a JSON object matching this JSON schema, no prose: "
                    + json.dumps(json_schema),
                }
            )
        try:
            r = self.client.post(f"{self.host}/api/chat", json=body)
        except httpx.TransportError as exc:
            raise TransientError(f"cannot reach Ollama at {self.host}: {exc}") from exc
        if r.status_code == 501 and "structured output" in r.text and "format" in body:
            self.supports_format = False
            return self._chat(messages, tools, tool_choice=tool_choice, json_schema=json_schema)
        if r.status_code >= 500:
            raise TransientError(f"Ollama {r.status_code}: {r.text[:300]}")
        if r.status_code != 200:
            raise ProviderError(f"Ollama {r.status_code}: {r.text[:300]}")
        data = r.json()
        msg = data.get("message", {})
        calls = []
        for c in msg.get("tool_calls") or []:
            fn = c.get("function", {})
            args = fn.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {"_raw": args}
            calls.append(
                ToolCall(
                    id=c.get("id") or f"call_{uuid.uuid4().hex[:8]}",
                    name=fn.get("name", ""),
                    arguments=args,
                )
            )
        return LLMResponse(
            message=Message(role="assistant", content=msg.get("content") or "", tool_calls=calls),
            usage=Usage(
                input_tokens=int(data.get("prompt_eval_count") or 0),
                output_tokens=int(data.get("eval_count") or 0),
            ),
            model=self.model,
        )
