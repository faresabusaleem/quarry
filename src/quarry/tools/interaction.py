"""ask_user and final_answer: the two ways a run ends."""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from quarry.tools.base import RunContext, Tool, ToolResult


class AskUserArgs(BaseModel):
    question: str = Field(description="One short clarifying question.")
    options: list[str] = Field(
        min_length=2, max_length=5, description="2-5 short answers the user can click."
    )
    reason: str = Field(description="Why the question is ambiguous, in one sentence.")


class AskUserTool(Tool):
    name = "ask_user"
    description = (
        "Ask the user a clarifying question when the request has several reasonable meanings "
        "that would give different answers (for example revenue vs order count, or which time "
        "period). Ends the run; the user's reply starts the next one. Do not use it when the "
        "glossary already settles the meaning."
    )
    Args = AskUserArgs

    def run(self, args: AskUserArgs, ctx: RunContext) -> ToolResult:
        return ToolResult(
            ok=True,
            content="Question sent to the user. Stop here and wait for the reply.",
            data=args.model_dump(),
            terminal=True,
        )


class Citation(BaseModel):
    id: str = Field(pattern=r"^n\d+$", description="Marker id used in the answer text, e.g. n1.")
    text: str = Field(
        description="The number as written for the reader, e.g. 'R$ 1.26M' or '18.4%'."
    )
    value: float = Field(description="The exact unrounded value as it appears in the result.")
    source_id: str = Field(description="Result id that contains the value, e.g. q3 or py1.")


class FinalAnswerArgs(BaseModel):
    status: Literal["answered", "refused"] = Field(
        default="answered",
        description="'answered' for an analysis; 'refused' when the request is out of scope or unsafe.",
    )
    answer: str = Field(
        description=(
            "The answer in 2-6 short sentences of plain Markdown. Write every number as a "
            "marker like [n1] that matches a citation; never type a figure directly."
        )
    )
    citations: list[Citation] = Field(default_factory=list)
    result_query_id: str | None = Field(
        default=None, description="The result id whose rows best answer the question."
    )
    chart_ids: list[str] = Field(default_factory=list, description="Charts to show, e.g. ['c1'].")
    caveats: list[str] = Field(default_factory=list, description="Assumptions and data limits.")


_MARKER = re.compile(r"\[(n\d+)\]")
_NUMBER_TOKEN = re.compile(r"(?<![\w.\[-])\d[\d,]*(?:\.\d+)?%?")


def _stray_numbers(text: str) -> list[str]:
    """Figures typed directly into the answer instead of cited.

    Small integers ("top 5", "Q2") and years are allowed; decimals, percentages and numbers
    with three or more digits are what an analyst would compute, so they must be cited.
    """
    out = []
    for tok in _NUMBER_TOKEN.findall(text):
        digits = re.sub(r"\D", "", tok)
        if re.fullmatch(r"(19|20)\d\d", tok):
            continue
        if "." in tok or tok.endswith("%") or len(digits) >= 3:
            out.append(tok)
    return out


def _numeric_cells(rows: list[list[Any]]) -> list[float]:
    out: list[float] = []
    for row in rows:
        for v in row:
            if isinstance(v, bool):
                continue
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            if math.isfinite(f):
                out.append(f)
    return out


def value_in_result(value: float, rows: list[list[Any]], row_count: int) -> bool:
    """True if `value` matches some cell, allowing rounding and percent scaling."""
    candidates = [*_numeric_cells(rows), float(row_count)]
    for cell in candidates:
        for scaled in (cell, cell * 100):
            if math.isclose(value, scaled, rel_tol=5e-3, abs_tol=0.011):
                return True
    return False


class FinalAnswerTool(Tool):
    name = "final_answer"
    description = (
        "Finish the run with a structured answer. Every number in the text must be a [nX] "
        "marker backed by a citation whose value appears in the cited result. Use "
        "status='refused' with a brief explanation when the request is out of scope."
    )
    Args = FinalAnswerArgs

    # The grounding check below is the agent's 'reflect' step for answers: an answer that
    # cites a number that no query produced is sent back for correction. After a couple of
    # rejections we accept it but mark the unverified numbers, so a run can always finish.
    max_rejections = 2

    def run(self, args: FinalAnswerArgs, ctx: RunContext) -> ToolResult:
        problems = self.validate(args, ctx)
        rejections = ctx._counters.get("final_rejections", 0)
        if problems and rejections < self.max_rejections:
            ctx._counters["final_rejections"] = rejections + 1
            return ToolResult.fail(
                "final_answer rejected, fix and call it again: " + " ".join(problems),
                data={"problems": problems},
            )
        data = args.model_dump()
        data["unverified"] = problems
        return ToolResult(ok=True, content="Answer delivered.", data=data, terminal=True)

    @staticmethod
    def validate(args: FinalAnswerArgs, ctx: RunContext) -> list[str]:
        problems: list[str] = []
        if args.status == "refused":
            return problems
        ids = {c.id for c in args.citations}
        markers = set(_MARKER.findall(args.answer))
        for missing in sorted(markers - ids):
            problems.append(f"marker [{missing}] has no citation.")
        for c in args.citations:
            src = ctx.source(c.source_id)
            if src is None:
                problems.append(f"{c.id} cites unknown result {c.source_id!r}.")
            elif not src.ok:
                problems.append(f"{c.id} cites failed result {c.source_id!r}.")
            elif not value_in_result(c.value, src.rows, len(src.rows)):
                problems.append(
                    f"{c.id} value {c.value:g} does not appear in {c.source_id}; compute it in SQL "
                    "and cite that result."
                )
        stray = _stray_numbers(_MARKER.sub("", args.answer))
        if stray:
            problems.append(
                f"the answer contains uncited numbers {stray[:3]}; replace them with [nX] markers."
            )
        if args.result_query_id is not None:
            src = ctx.source(args.result_query_id)
            if src is None or not src.ok:
                problems.append(
                    f"result_query_id {args.result_query_id!r} is not a successful result."
                )
        for cid in args.chart_ids:
            if cid not in ctx.charts:
                problems.append(f"unknown chart id {cid!r}.")
        return problems
