"""Schema exploration tools: list_tables, describe_table, sample_rows."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from quarry.tools.base import RunContext, Tool, ToolResult, format_table, wrap_data

_STATS_CACHE: dict[tuple[str, str], list[dict[str, Any]]] = {}


class ListTablesArgs(BaseModel):
    pass


class ListTablesTool(Tool):
    name = "list_tables"
    description = "List every table in the warehouse with its row count and a one-line description."
    Args = ListTablesArgs

    def run(self, args: ListTablesArgs, ctx: RunContext) -> ToolResult:
        rows = ctx.cursor.execute(
            "SELECT table_name, estimated_size, comment FROM duckdb_tables() "
            "WHERE schema_name = 'main' ORDER BY table_name"
        ).fetchall()
        tables = []
        for name, _estimate, comment in rows:
            (count,) = ctx.cursor.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()
            tables.append({"table": name, "rows": int(count), "description": comment or ""})
        body = "\n".join(f"- {t['table']} ({t['rows']:,} rows): {t['description']}" for t in tables)
        return ToolResult(ok=True, content=body, data={"tables": tables})


class DescribeTableArgs(BaseModel):
    table: str = Field(description="Table name, e.g. 'orders'.")


class DescribeTableTool(Tool):
    name = "describe_table"
    description = (
        "Show a table's columns with type, meaning, null share and, for numeric or date "
        "columns, the range; for low-cardinality text columns, the most common values."
    )
    Args = DescribeTableArgs

    def run(self, args: DescribeTableArgs, ctx: RunContext) -> ToolResult:
        table = args.table.strip().strip('"').lower()
        known = ctx.db.tables()
        if table not in known:
            return ToolResult.fail(f"unknown table {args.table!r}. Available: {', '.join(known)}")
        cols = self._stats(ctx, table)
        lines = []
        for c in cols:
            extra = f"nulls {c['null_pct']:.0f}%"
            if c.get("min") is not None:
                extra += f", range {c['min']} .. {c['max']}"
            if c.get("approx_unique") is not None:
                extra += f", ~{c['approx_unique']:,} distinct"
            if c.get("top_values"):
                extra += ", values: " + ", ".join(
                    f"{v['value']} ({v['count']:,})" for v in c["top_values"]
                )
            lines.append(f"- {c['column']} {c['type']}: {c['comment']} [{extra}]")
        (comment,) = ctx.cursor.execute(
            "SELECT comment FROM duckdb_tables() WHERE table_name = ?", [table]
        ).fetchone()
        body = f"{table}: {comment}\n" + "\n".join(lines)
        # Top values come from customer-entered data, so the whole block is fenced.
        return ToolResult(
            ok=True,
            content=wrap_data(ctx, f"describe {table}", body),
            data={"table": table, "columns": cols},
        )

    @staticmethod
    def _stats(ctx: RunContext, table: str) -> list[dict[str, Any]]:
        key = (str(ctx.db.path), table)
        if key in _STATS_CACHE:
            return _STATS_CACHE[key]
        meta = ctx.cursor.execute(
            "SELECT column_name, data_type, comment FROM duckdb_columns() "
            "WHERE table_name = ? ORDER BY column_index",
            [table],
        ).fetchall()
        summary = {
            r[0]: r for r in ctx.cursor.execute(f'SUMMARIZE "{table}"').fetchall()
        }  # column_name, column_type, min, max, approx_unique, avg, std, q25, q50, q75, count, null_percentage
        out: list[dict[str, Any]] = []
        for name, dtype, comment in meta:
            s = summary.get(name)
            col: dict[str, Any] = {"column": name, "type": dtype, "comment": comment or ""}
            if s is not None:
                col["null_pct"] = float(s[11] or 0)
                col["approx_unique"] = int(s[4]) if s[4] is not None else None
                if dtype != "VARCHAR":
                    col["min"], col["max"] = s[2], s[3]
            if (
                dtype == "VARCHAR"
                and col.get("approx_unique") is not None
                and col["approx_unique"] <= 30
            ):
                top = ctx.cursor.execute(
                    f'SELECT "{name}", COUNT(*) c FROM "{table}" WHERE "{name}" IS NOT NULL '
                    f"GROUP BY 1 ORDER BY 2 DESC LIMIT 12"
                ).fetchall()
                col["top_values"] = [{"value": v, "count": int(c)} for v, c in top]
            out.append(col)
        _STATS_CACHE[key] = out
        return out


class SampleRowsArgs(BaseModel):
    table: str = Field(description="Table name.")
    n: int = Field(default=5, ge=1, le=10, description="Number of rows, 1-10.")
    columns: list[str] | None = Field(
        default=None, description="Optional subset of columns to return."
    )


class SampleRowsTool(Tool):
    name = "sample_rows"
    description = (
        "Return a few example rows from a table (a repeatable random sample) to see what "
        "values look like. Use run_sql for filtered or aggregated data."
    )
    Args = SampleRowsArgs

    def run(self, args: SampleRowsArgs, ctx: RunContext) -> ToolResult:
        table = args.table.strip().strip('"').lower()
        known = ctx.db.tables()
        if table not in known:
            return ToolResult.fail(f"unknown table {args.table!r}. Available: {', '.join(known)}")
        valid = [
            r[0]
            for r in ctx.cursor.execute(
                "SELECT column_name FROM duckdb_columns() WHERE table_name = ? ORDER BY column_index",
                [table],
            ).fetchall()
        ]
        cols = valid
        if args.columns:
            bad = [c for c in args.columns if c not in valid]
            if bad:
                return ToolResult.fail(
                    f"unknown columns {bad} in {table}. Columns: {', '.join(valid)}"
                )
            cols = args.columns
        col_sql = ", ".join(f'"{c}"' for c in cols)
        # Fixed seed: the same call always shows the same rows, which keeps runs reproducible.
        cur = ctx.cursor.execute(
            f'SELECT {col_sql} FROM "{table}" USING SAMPLE reservoir({args.n} ROWS) REPEATABLE (7)'
        )
        rows = [list(r) for r in cur.fetchall()]
        body = format_table(cols, rows, args.n)
        return ToolResult(
            ok=True,
            content=wrap_data(ctx, f"sample {table}", body),
            data={"table": table, "columns": cols, "rows": rows},
        )
