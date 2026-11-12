"""run_python and make_chart."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from quarry.sandbox.executor import isolation_prefix, run_python
from quarry.tools.base import (
    ChartRecord,
    PythonRecord,
    RunContext,
    Tool,
    ToolResult,
    format_table,
    wrap_data,
)
from quarry.tools.db import to_jsonable


class RunPythonArgs(BaseModel):
    code: str = Field(
        description=(
            "Python using pandas (pd), numpy (np) or scipy. Each input result is available as "
            "a DataFrame named df_<id>, e.g. df_q1. Assign the output to a variable named "
            "`result` (DataFrame, Series or number); print() for short notes."
        )
    )
    inputs: list[str] = Field(description="Result ids to load, e.g. ['q1', 'q2'].")


class RunPythonTool(Tool):
    name = "run_python"
    description = (
        "Analyse existing query results with pandas/numpy/scipy in an isolated sandbox (no "
        "network, no files, 10 s, 512 MB). Use it for statistics SQL cannot do easily, such "
        "as correlations or regressions. Returns an id (py1 ...) that can be cited."
    )
    Args = RunPythonArgs

    @staticmethod
    def available() -> tuple[bool, str]:
        prefix, label = isolation_prefix()
        return prefix is not None, label

    def run(self, args: RunPythonArgs, ctx: RunContext) -> ToolResult:
        if not ctx.settings.python_enabled:
            return ToolResult.fail("run_python is disabled on this deployment; use SQL instead.")
        frames: dict[str, dict[str, Any]] = {}
        for source_id in args.inputs:
            src = ctx.source(source_id)
            if src is None or not src.ok:
                return ToolResult.fail(f"unknown or failed result id {source_id!r}")
            frames[f"df_{source_id}"] = {"columns": src.columns, "rows": to_jsonable(src.rows)}
        pid = ctx.next_id("py")
        res = run_python(
            args.code,
            frames,
            timeout_s=ctx.settings.python_timeout_s,
            memory_mb=ctx.settings.python_memory_mb,
        )
        rec = PythonRecord(
            id=pid,
            code=args.code,
            inputs=args.inputs,
            ok=res.ok,
            stdout=res.stdout,
            columns=res.columns,
            rows=res.rows,
            error=res.error,
            elapsed_ms=res.elapsed_ms,
        )
        ctx.python_runs[pid] = rec
        if not res.ok:
            return ToolResult.fail(f"{pid} failed: {res.error}", data=rec.to_dict())
        body = ""
        if res.stdout.strip():
            body += "stdout:\n" + res.stdout.strip()[:3000] + "\n"
        if res.columns:
            body += "result:\n" + format_table(res.columns, res.rows, ctx.settings.sql_preview_rows)
        return ToolResult(
            ok=True,
            content=f"{pid} succeeded.\n" + wrap_data(ctx, pid, body or "(no output)"),
            data=rec.to_dict(),
        )


_TEMPORAL = re.compile(r"^\d{4}-\d{2}(-\d{2})?([ T].*)?$")


def _field_type(col_type: str, values: list[Any]) -> str:
    t = col_type.upper()
    if any(k in t for k in ("DATE", "TIMESTAMP", "TIME")):
        return "temporal"
    if any(k in t for k in ("INT", "DECIMAL", "DOUBLE", "FLOAT", "REAL", "NUMERIC", "HUGEINT")):
        return "quantitative"
    sample = [v for v in values if v is not None][:20]
    if sample and all(isinstance(v, int | float) and not isinstance(v, bool) for v in sample):
        return "quantitative"
    if sample and all(isinstance(v, str) and _TEMPORAL.match(v) for v in sample):
        return "temporal"
    return "nominal"


class MakeChartArgs(BaseModel):
    source_id: str = Field(description="Result id to plot, e.g. 'q2'.")
    mark: Literal["bar", "line", "area", "point"] = Field(description="Chart type.")
    x: str = Field(description="Column for the x axis (or categories for a bar chart).")
    y: str = Field(description="Numeric column for the y axis.")
    color: str | None = Field(
        default=None, description="Optional column to split series by colour."
    )
    title: str = Field(description="Short chart title stating what is shown.")
    sort_desc: bool = Field(default=False, description="Bar charts: sort bars by y, largest first.")


class MakeChartTool(Tool):
    name = "make_chart"
    description = (
        "Create a chart from an existing result. Produces a declarative Vega-Lite spec (no "
        "plotting code runs). Use line for time series, bar for comparing categories."
    )
    Args = MakeChartArgs

    def run(self, args: MakeChartArgs, ctx: RunContext) -> ToolResult:
        src = ctx.source(args.source_id)
        if src is None or not src.ok:
            return ToolResult.fail(f"unknown or failed result id {args.source_id!r}")
        missing = [c for c in (args.x, args.y, args.color) if c and c not in src.columns]
        if missing:
            return ToolResult.fail(
                f"columns {missing} not in {args.source_id}; columns: {src.columns}"
            )
        if len(src.rows) > 400:
            return ToolResult.fail("too many rows to chart (max 400); aggregate first")
        if args.color:
            ci = src.columns.index(args.color)
            series = {str(r[ci]) for r in src.rows}
            # The palette has six validated colours; more series would reuse colours.
            if len(series) > 6:
                return ToolResult.fail(
                    f"{len(series)} colour series is too many (max 6); keep the top 5 and "
                    "group the rest as 'Other' in SQL, or drop the colour split"
                )
        types = getattr(src, "types", None) or [""] * len(src.columns)
        idx = {c: i for i, c in enumerate(src.columns)}

        def ftype(col: str) -> str:
            return _field_type(types[idx[col]], [r[idx[col]] for r in src.rows])

        x_type, y_type = ftype(args.x), ftype(args.y)
        if y_type != "quantitative":
            return ToolResult.fail(f"y column {args.y!r} must be numeric")
        values = [
            {c: to_jsonable(r[idx[c]]) for c in (args.x, args.y, args.color) if c} for r in src.rows
        ]
        x_enc: dict[str, Any] = {"field": args.x, "type": x_type, "title": args.x.replace("_", " ")}
        y_enc: dict[str, Any] = {
            "field": args.y,
            "type": "quantitative",
            "title": args.y.replace("_", " "),
        }
        if args.mark == "bar" and x_type == "nominal" and args.sort_desc:
            x_enc["sort"] = "-y"
        encoding: dict[str, Any] = {"x": x_enc, "y": y_enc}
        # Long category labels read better on a horizontal bar chart.
        if args.mark == "bar" and x_type == "nominal" and len(values) > 8:
            if args.sort_desc:
                x_enc["sort"] = "-x"
            encoding = {"y": x_enc, "x": y_enc}
        if args.color:
            encoding["color"] = {
                "field": args.color,
                "type": "nominal",
                "title": args.color.replace("_", " "),
            }
        encoding["tooltip"] = [
            {"field": c, "type": ftype(c)} for c in (args.x, args.y, args.color) if c
        ]
        spec = {
            "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
            "title": args.title,
            "data": {"values": values},
            "mark": {"type": args.mark, "point": args.mark == "line"}
            if args.mark == "line"
            else {"type": args.mark},
            "encoding": encoding,
            "width": "container",
            "height": 280
            if "y" not in encoding or encoding["y"] is y_enc
            else max(200, 22 * len(values)),
        }
        cid = ctx.next_id("c")
        ctx.charts[cid] = ChartRecord(id=cid, source_id=args.source_id, title=args.title, spec=spec)
        return ToolResult(
            ok=True,
            content=f"chart {cid} created from {args.source_id} ({args.mark}, {len(values)} points). "
            f"Include '{cid}' in final_answer.chart_ids to show it.",
            data=ctx.charts[cid].to_dict(),
        )
