"""A scripted provider for tests: CI exercises the whole loop without calling any API."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from quarry.llm.base import LLMProvider, LLMResponse, Message, ToolCall, Usage
from quarry.tools.base import ToolSpec

Script = Callable[[list[Message], list[ToolSpec] | None, dict[str, Any] | None], Message]


def call(name: str, **arguments: Any) -> Message:
    """Shorthand for an assistant message that calls one tool."""
    return Message(
        role="assistant",
        tool_calls=[ToolCall(id=f"call_{name}", name=name, arguments=arguments)],
    )


def text(content: str) -> Message:
    return Message(role="assistant", content=content)


class FakeProvider(LLMProvider):
    name = "fake"

    def __init__(self, script: list[Message] | Script, model: str = "fake-1"):
        super().__init__(max_retries=0)
        self.model = model
        self.script = script
        self.calls: list[dict[str, Any]] = []

    def _chat(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None,
        *,
        tool_choice: Literal["auto", "required"] | str,
        json_schema: dict[str, Any] | None,
    ) -> LLMResponse:
        self.calls.append(
            {
                "messages": list(messages),
                "tools": tools,
                "tool_choice": tool_choice,
                "json_schema": json_schema,
            }
        )
        if callable(self.script):
            msg = self.script(messages, tools, json_schema)
        else:
            if not self.script:
                raise AssertionError("FakeProvider ran out of scripted responses")
            msg = self.script.pop(0)
        prompt_chars = sum(len(m.content) for m in messages)
        return LLMResponse(
            message=msg,
            usage=Usage(
                input_tokens=prompt_chars // 4, output_tokens=max(1, len(msg.content) // 4)
            ),
            model=self.model,
        )
