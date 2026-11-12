"use client";

import { useState } from "react";

import type { Step } from "@/lib/run";
import { formatMs } from "@/lib/run";
import { Python, Sql } from "./Code";
import { IconAlert, IconCheck, IconChevron, TOOL_META } from "./icons";
import { ResultTable } from "./ResultTable";

function summary(step: Step): string {
  const a = step.args ?? {};
  switch (step.tool) {
    case "describe_table":
    case "sample_rows":
      return String(a.table ?? "");
    case "run_sql":
      return String(a.purpose ?? a.sql ?? "");
    case "run_python":
      return `analyse ${(a.inputs ?? []).join(", ")}`;
    case "make_chart":
      return String(a.title ?? "");
    default:
      return "";
  }
}

function resultLabel(step: Step): string | null {
  const d = step.data;
  if (!d || step.status !== "ok") return null;
  if (step.tool === "run_sql" || step.tool === "run_python") {
    return `${d.id} · ${Number(d.row_count ?? 0).toLocaleString("en-US")}${d.truncated ? "+" : ""} rows`;
  }
  if (step.tool === "describe_table") return `${(d.columns ?? []).length} columns`;
  if (step.tool === "list_tables") return `${(d.tables ?? []).length} tables`;
  if (step.tool === "make_chart") return d.id;
  return null;
}

export function StepCard({ step, defaultOpen = false }: { step: Step; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || step.status === "error");
  const meta = TOOL_META[step.tool] ?? { label: step.tool, Icon: TOOL_META.run_sql.Icon };
  const { Icon } = meta;
  const id = `step-${step.callId}`;
  const d = step.data ?? {};
  const label = resultLabel(step);

  return (
    <li className="step">
      <button type="button" className="step-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="step-num num">{step.index}</span>
        <span className="step-icon">
          <Icon />
        </span>
        <span className="step-title">
          <span className="step-tool">{meta.label}</span>
          <span className="step-summary">{summary(step)}</span>
        </span>
        <span className="step-meta">
          {label && <span className="mono">{label}</span>}
          {step.latencyMs !== undefined && <span className="num">{formatMs(step.latencyMs)}</span>}
          {step.status === "running" && <span className="spinner" aria-label="Running" />}
          {step.status === "ok" && <IconCheck className="status-ok" aria-label="Succeeded" role="img" />}
          {step.status === "error" && <IconAlert className="status-error" aria-label="Failed" role="img" />}
          <IconChevron />
        </span>
      </button>
      {open && (
        <div className="step-body" id={id}>
          {step.note && <p className="step-note">{step.note}</p>}
          {step.tool === "run_sql" && step.args.sql && <Sql code={String(step.args.sql)} />}
          {step.tool === "run_python" && step.args.code && <Python code={String(step.args.code)} />}
          {step.status === "ok" && (step.tool === "run_sql" || step.tool === "run_python") && d.columns?.length > 0 && (
            <ResultTable columns={d.columns} rows={d.rows ?? []} limit={8} total={d.row_count} truncated={d.truncated} />
          )}
          {step.status === "ok" && step.tool === "run_python" && d.stdout && <Python code={String(d.stdout)} />}
          {step.status === "ok" && step.tool === "describe_table" && (
            <ResultTable
              columns={["column", "type", "meaning"]}
              rows={(d.columns ?? []).map((c: any) => [c.column, c.type, c.comment])}
              limit={30}
            />
          )}
          {step.status === "ok" && step.tool === "sample_rows" && (
            <ResultTable columns={d.columns ?? []} rows={d.rows ?? []} limit={10} />
          )}
          {step.status === "ok" && step.tool === "list_tables" && (
            <ResultTable
              columns={["table", "rows", "description"]}
              rows={(d.tables ?? []).map((t: any) => [t.table, t.rows, t.description])}
              limit={20}
            />
          )}
          {step.status === "error" && (
            <div className="step-error" role="alert">
              <strong>{d.blocked ? "Blocked by the SQL guard. " : "Error. "}</strong>
              {step.error}
            </div>
          )}
          {step.reflection && <p className="step-fix">{step.reflection}</p>}
        </div>
      )}
    </li>
  );
}
