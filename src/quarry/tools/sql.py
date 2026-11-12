"""run_sql: the agent's main way to answer questions."""

from __future__ import annotations

import re

import duckdb
from pydantic import BaseModel, Field

from quarry.tools.base import QueryRecord, RunContext, Tool, ToolResult, format_table, wrap_data
from quarry.tools.db import execute_with_limits
from quarry.tools.sql_guard import check_sql


class RunSqlArgs(BaseModel):
    sql: str = Field(description="One read-only DuckDB SELECT query.")
    purpose: str = Field(
        description="A short phrase saying what this query computes, shown to the user."
    )


def _clean_error(message: str) -> str:
    # DuckDB errors include a caret diagram over several lines; the first lines carry the
    # meaning and the "Did you mean" hints, which is what the agent needs to self-correct.
    lines = [ln for ln in message.splitlines() if ln.strip()]
    return " ".join(lines[:4])[:600]


class RunSqlTool(Tool):
    name = "run_sql"
    description = (
        "Run one read-only DuckDB SELECT against the warehouse. Returns a result id (q1, q2 "
        "...) that you cite in the final answer, the columns, and a preview of the rows. "
        "Results are capped at 1,000 rows and queries time out after a few seconds. Compute "
        "every number you will report in SQL, including growth rates, shares and differences. "
        "Follow the glossary: revenue, order counts and 'sold' exclude canceled and "
        "unavailable orders; payments, reviews and the catalogue do not."
    )
    Args = RunSqlArgs

    def run(self, args: RunSqlArgs, ctx: RunContext) -> ToolResult:
        sql = re.sub(r";\s*$", "", args.sql.strip())
        qid = ctx.next_id("q")
        guard = check_sql(sql, ctx.db.tables())
        if not guard.ok:
            rec = QueryRecord(id=qid, sql=sql, purpose=args.purpose, ok=False, error=guard.reason)
            ctx.queries[qid] = rec
            return ToolResult.fail(
                f"query {qid} was blocked by the SQL guard: {guard.reason}",
                data={**rec.to_dict(), "blocked": True},
            )
        try:
            res = execute_with_limits(
                ctx.cursor,
                sql,
                max_rows=ctx.settings.sql_row_limit,
                timeout_s=ctx.settings.sql_timeout_s,
            )
        except (duckdb.Error, TimeoutError) as exc:
            message = _clean_error(str(exc))
            rec = QueryRecord(id=qid, sql=sql, purpose=args.purpose, ok=False, error=message)
            ctx.queries[qid] = rec
            return ToolResult.fail(f"query {qid} failed: {message}", data=rec.to_dict())

        rec = QueryRecord(
            id=qid,
            sql=sql,
            purpose=args.purpose,
            ok=True,
            columns=res.columns,
            types=res.types,
            rows=res.rows,
            truncated=res.truncated,
            elapsed_ms=res.elapsed_ms,
        )
        ctx.queries[qid] = rec
        preview = ctx.settings.sql_preview_rows
        shown = min(preview, len(res.rows))
        total = f"{len(res.rows):,}{'+' if res.truncated else ''}"
        header = f"{qid}: {total} rows, columns: " + ", ".join(
            f"{c} ({t})" for c, t in zip(res.columns, res.types, strict=True)
        )
        body = format_table(res.columns, res.rows, preview)
        note = ""
        if len(res.rows) > shown:
            note = f"\nShowing {shown} of {total} rows. Aggregate or filter in SQL to see the rest."
        if res.truncated:
            note += " The result hit the 1,000-row cap; add aggregation or a LIMIT."
        if not res.rows:
            note = "\nThe query returned no rows. Check filters, date ranges and value spellings."
        return ToolResult(
            ok=True,
            content=header + "\n" + wrap_data(ctx, qid, body) + note,
            data=rec.to_dict(),
        )
