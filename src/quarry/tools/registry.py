"""The tool set the agent sees, and a single entry point to execute a call."""

from __future__ import annotations

from typing import Any

from quarry.tools.analysis import MakeChartTool, RunPythonTool
from quarry.tools.base import RunContext, Tool, ToolResult, ToolSpec
from quarry.tools.catalog import DescribeTableTool, ListTablesTool, SampleRowsTool
from quarry.tools.interaction import AskUserTool, FinalAnswerTool
from quarry.tools.sql import RunSqlTool


class ToolRegistry:
    def __init__(self, tools: list[Tool]):
        self.tools = {t.name: t for t in tools}

    @classmethod
    def default(cls, *, python_enabled: bool = True) -> ToolRegistry:
        tools: list[Tool] = [
            ListTablesTool(),
            DescribeTableTool(),
            SampleRowsTool(),
            RunSqlTool(),
            MakeChartTool(),
            AskUserTool(),
            FinalAnswerTool(),
        ]
        if python_enabled and RunPythonTool.available()[0]:
            tools.insert(4, RunPythonTool())
        return cls(tools)

    def specs(self) -> list[ToolSpec]:
        return [t.spec() for t in self.tools.values()]

    def execute(self, name: str, args: dict[str, Any], ctx: RunContext) -> ToolResult:
        tool = self.tools.get(name)
        if tool is None:
            return ToolResult.fail(f"unknown tool {name!r}. Available: {', '.join(self.tools)}")
        return tool(args, ctx)
