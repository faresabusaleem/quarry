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
    id: str = Field(pattern=r"^[na]\d+$", description="Marker id used in the answer text, e.g. n1.")
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
            "The answer in 2-6 short sentences of plain Markdown. Write figures the way a "
            "reader should see them (R$ 1.26M, 18.4%, 7,187 orders). Every figure is checked "
            "against your query results and linked to the result that contains it; a figure "
            "that no result contains is rejected, so compute every figure in SQL first."
        )
    )
    citations: list[Citation] = Field(default_factory=list)
    result_query_id: str | None = Field(
        default=None, description="The result id whose rows best answer the question."
    )
    chart_ids: list[str] = Field(default_factory=list, description="Charts to show, e.g. ['c1'].")
    caveats: list[str] = Field(default_factory=list, description="Assumptions and data limits.")


_MARKER = re.compile(r"\[([na]\d+)\]")


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


_FIGURE_BEFORE_MARKER = re.compile(
    r"(?P<fig>(?:R\$\s?)?-?\d[\d,]*(?:\.\d+)?\s?(?:%|[KMB]\b|million\b|billion\b)?)"
    r"\s*\(?\s*\[(?P<id>n\d+)\]\)?"
)
_SCALE = {"k": 1e3, "m": 1e6, "million": 1e6, "b": 1e9, "billion": 1e9}


def _parse_figure(fig: str) -> tuple[float, bool] | None:
    text = fig.replace("R$", "").replace(",", "").strip()
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s?(%|[KMB]|million|billion)?", text, re.I)
    if not m:
        return None
    value = float(m.group(1))
    unit = (m.group(2) or "").lower()
    if unit in _SCALE:
        value *= _SCALE[unit]
    return value, unit == "%"


def fold_inline_figures(answer: str, citations: list[Citation]) -> tuple[str, list[str]]:
    """Accept 'R$ 2,960,470 [n1]' as well as '[n1]'.

    Models naturally write the figure and then the marker. If the written figure agrees with
    the citation's value it is redundant, so it is folded into the marker (the UI shows the
    citation text); if it disagrees, that is a grounding error worth sending back.
    """
    by_id = {c.id: c for c in citations}
    problems: list[str] = []

    def repl(m: re.Match[str]) -> str:
        c = by_id.get(m.group("id"))
        parsed = _parse_figure(m.group("fig"))
        if c is None or parsed is None:
            return m.group(0)
        fig, is_pct = parsed
        targets = [c.value, c.value * 100] if is_pct else [c.value]
        if any(math.isclose(fig, t, rel_tol=0.02, abs_tol=0.011) for t in targets):
            return f"[{c.id}]"
        problems.append(
            f"the figure {m.group('fig').strip()!r} written next to [{c.id}] does not match its "
            f"cited value {c.value:g}."
        )
        return m.group(0)

    return _FIGURE_BEFORE_MARKER.sub(repl, answer), problems


_FIGURE = re.compile(
    r"(?<![\w.\[-])(?P<fig>(?:R\$\s?)?-?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|[KMB]\b|million\b|billion\b))?)"
)


def _figure_matches(written: str, cell: float) -> bool:
    """Does a figure as written agree with a result cell, given the precision it shows?

    'R$ 1.26M' shows two decimals of millions, so it matches 1,255,695 but not 1,300,000;
    '18.4%' matches a share of 0.1843. Rounding is fine, a wrong digit is not.
    """
    text = written.replace("R$", "").replace(",", "").strip()
    m = re.fullmatch(r"(-?\d+)(?:\.(\d+))?\s?(%|[KMB]|million|billion)?", text, re.I)
    if not m:
        return False
    decimals = len(m.group(2) or "")
    unit = (m.group(3) or "").lower()
    scale = _SCALE.get(unit, 1.0)
    value = float(f"{m.group(1)}.{m.group(2) or 0}") * scale
    tolerance = 0.51 * 10**-decimals * scale + 1e-9
    targets = [cell * 100, cell] if unit == "%" else [cell]
    return any(abs(value - t) <= tolerance for t in targets)


def auto_ground(
    answer: str, citations: list[Citation], ctx: RunContext, preferred: list[str]
) -> tuple[str, list[Citation], list[str]]:
    """Link every figure typed in the answer to a result that contains it.

    This is grounding by verification rather than by format: the model can write numbers
    naturally, and each one becomes a citation if (and only if) some successful query or
    analysis produced it. Figures found nowhere are returned as unverified.
    """
    order: list[str] = []
    for sid in [*preferred, *reversed(list(ctx.queries)), *reversed(list(ctx.python_runs))]:
        src = ctx.source(sid)
        if sid not in order and src is not None and src.ok:
            order.append(sid)
    new: list[Citation] = []
    unmatched: list[str] = []
    counter = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal counter
        fig = m.group("fig").strip()
        digits = re.sub(r"\D", "", fig)
        is_year = re.fullmatch(r"(19|20)\d\d", fig) is not None
        significant = (
            "." in fig or "%" in fig or "R$" in fig or len(digits) >= 3 or fig[-1:] in "KMB"
        )
        if is_year or not significant:
            return m.group(0)
        for sid in order:
            src = ctx.source(sid)
            assert src is not None
            for cell in [*_numeric_cells(src.rows), float(len(src.rows))]:
                if _figure_matches(fig, cell):
                    counter += 1
                    cid = f"a{counter}"
                    new.append(Citation(id=cid, text=fig, value=cell, source_id=sid))
                    return m.group(0).replace(fig, f"[{cid}]")
        unmatched.append(fig)
        return m.group(0)

    # Only touch text outside existing [nX] markers.
    parts = re.split(r"(\[[na]\d+\])", answer)
    linked = "".join(p if _MARKER.fullmatch(p) else _FIGURE.sub(repl, p) for p in parts)

    # A model that wrote "R$ 837,895 in February [n1]" now has the figure linked twice;
    # drop the explicit marker when an auto-link already shows the same value.
    for c in citations:
        if any(
            a.source_id == c.source_id
            and math.isclose(a.value, c.value, rel_tol=1e-6, abs_tol=1e-9)
            for a in new
        ):
            linked = re.sub(rf"\s?\[{c.id}\]", "", linked)
    return linked, [*citations, *new], unmatched


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
        "Finish the run with a structured answer. Every figure in the text is verified "
        "against your query results and linked to its source; figures that no result "
        "contains are rejected. Use status='refused' with a brief explanation when the "
        "request is out of scope."
    )
    Args = FinalAnswerArgs

    # The grounding check below is the agent's 'reflect' step for answers: an answer that
    # cites a number that no query produced is sent back for correction. After a couple of
    # rejections we accept it but mark the unverified numbers, so a run can always finish.
    max_rejections = 2

    def run(self, args: FinalAnswerArgs, ctx: RunContext) -> ToolResult:
        fold_problems: list[str] = []
        if args.status == "answered":
            folded, fold_problems = fold_inline_figures(args.answer, args.citations)
            preferred = [
                x for x in [args.result_query_id, *(c.source_id for c in args.citations)] if x
            ]
            linked, citations, unmatched = auto_ground(folded, args.citations, ctx, preferred)
            args = args.model_copy(update={"answer": linked, "citations": citations})
            if unmatched:
                fold_problems.append(
                    f"these figures appear in no query result: {unmatched[:4]}. Compute them "
                    "in SQL (or remove them) and call final_answer again."
                )
        problems = fold_problems + self.validate(args, ctx)
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
