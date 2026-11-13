"use client";

import { ChartColumn, ChevronRight, CircleAlert, CircleCheck, Database, Rows3, Table2, Terminal, Wrench } from "lucide-react";
import { useState, type ComponentType } from "react";

import type { Step } from "@/lib/run";
import { formatMs } from "@/lib/run";
import { PlainBlock, SqlBlock } from "./Code";
import { ResultTable } from "./ResultTable";

export const TOOLS: Record<string, { label: string; Icon: ComponentType<{ "aria-hidden"?: boolean }> }> = {
  list_tables: { label: "List tables", Icon: Table2 },
  describe_table: { label: "Read table", Icon: Table2 },
  sample_rows: { label: "Sample rows", Icon: Rows3 },
  run_sql: { label: "Run SQL", Icon: Database },
  run_python: { label: "Python", Icon: Terminal },
  make_chart: { label: "Chart", Icon: ChartColumn },
};

function summary(step: Step): string {
  const a = step.args ?? {};
  switch (step.tool) {
    case "describe_table":
    case "sample_rows":
      return String(a.table ?? "");
    case "run_sql":
      return String(a.purpose ?? "").trim() || "Query";
    case "run_python":
      return `Analyse ${(a.inputs ?? []).join(", ")}`;
    case "make_chart":
      return String(a.title ?? "");
    case "list_tables":
      return "All tables";
    default:
      return "";
  }
}

function resultLabel(step: Step): string | null {
  const d = step.data;
  if (!d || step.status !== "ok") return null;
  if (step.tool === "run_sql" || step.tool === "run_python") {
    const rows = Number(d.row_count ?? 0);
    return `${d.id} · ${rows.toLocaleString("en-US")}${d.truncated ? "+" : ""} ${rows === 1 ? "row" : "rows"}`;
  }
  if (step.tool === "describe_table") return `${(d.columns ?? []).length} columns`;
  if (step.tool === "list_tables") return `${(d.tables ?? []).length} tables`;
  if (step.tool === "make_chart") return String(d.id ?? "");
  return null;
}

export function StepCard({ step, fixed, defaultOpen = false }: { step: Step; fixed?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = TOOLS[step.tool] ?? { label: step.tool, Icon: Wrench };
  const Icon = meta.Icon;
  const id = `step-${step.callId}`;
  const d = step.data ?? {};
  const label = resultLabel(step);
  const failed = step.status === "error";

  return (
    <li className={`step ${failed ? "is-error" : ""} ${fixed ? "is-fixed" : ""}`}>
      <button type="button" className="step-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="step-status" aria-hidden>
          {step.status === "running" ? <span className="spinner" /> : failed ? <CircleAlert /> : <Icon aria-hidden />}
        </span>
        <span className="step-title">
          <span className="step-tool">{meta.label}</span>
          <span className="step-summary">{summary(step)}</span>
        </span>
        <span className="step-meta">
          {failed && <span className="tag tag-error">Failed</span>}
          {fixed && (
            <span className="tag tag-fixed">
              <CircleCheck aria-hidden /> Fixed
            </span>
          )}
          {label && <span className="mono step-result">{label}</span>}
          {step.latencyMs !== undefined && <span className="mono step-time">{formatMs(step.latencyMs)}</span>}
          <ChevronRight className="chev" aria-hidden />
        </span>
        <span className="visually-hidden">{step.status === "running" ? "Running" : failed ? "Failed" : "Succeeded"}</span>
      </button>
      {open && (
        <div className="step-body" id={id}>
          {step.note && <p className="step-note">{step.note}</p>}
          {step.tool === "run_sql" && step.args.sql && <SqlBlock code={String(step.args.sql)} />}
          {step.tool === "run_python" && step.args.code && <PlainBlock code={String(step.args.code)} label="Python" />}
          {failed && (
            <div className="step-error" role="note">
              <p className="step-error-title">{d.blocked ? "Blocked by the SQL guard" : "Error"}</p>
              <p className="mono">{step.error}</p>
              {step.reflection && <p className="step-error-next">The agent read this error and retried with a fix.</p>}
            </div>
          )}
          {step.status === "ok" && (step.tool === "run_sql" || step.tool === "run_python") && d.columns?.length > 0 && (
            <ResultTable columns={d.columns} rows={d.rows ?? []} limit={8} total={d.row_count} truncated={d.truncated} caption={`Result ${d.id}`} />
          )}
          {step.status === "ok" && step.tool === "run_python" && d.stdout && <PlainBlock code={String(d.stdout)} label="Output" />}
          {step.status === "ok" && step.tool === "describe_table" && (
            <ResultTable
              columns={["column", "type", "meaning"]}
              rows={(d.columns ?? []).map((c: { column: string; type: string; comment: string }) => [c.column, c.type, c.comment])}
              limit={40}
              caption={`Columns of ${step.args.table}`}
            />
          )}
          {step.status === "ok" && step.tool === "sample_rows" && <ResultTable columns={d.columns ?? []} rows={d.rows ?? []} limit={10} caption="Sample rows" />}
          {step.status === "ok" && step.tool === "list_tables" && (
            <ResultTable
              columns={["table", "rows", "description"]}
              rows={(d.tables ?? []).map((t: { table: string; rows: number; description: string }) => [t.table, t.rows, t.description])}
              limit={20}
              caption="Tables"
            />
          )}
        </div>
      )}
    </li>
  );
}
