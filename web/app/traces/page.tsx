"use client";

// Trace viewer: every run is stored as a JSON trace (plan, each model and tool call with
// inputs, outputs, errors, tokens, latency and cost). The list links to a timeline view.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { IconChevron } from "@/components/icons";
import { getJson } from "@/lib/api";
import { formatMs, formatTokens } from "@/lib/run";

interface Summary {
  run_id: string;
  created: number;
  question: string;
  message?: string;
  provider: string;
  model: string;
  status: string;
  steps: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
}

interface Trace {
  summary: Summary;
  events: { type: string; ts: number; step: number | null; data: Record<string, any> }[];
}

const STATUS_BADGE: Record<string, string> = {
  answered: "ok",
  refused: "info",
  clarify: "info",
  stopped: "bad",
  error: "bad",
  budget_exhausted: "warn",
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? ""}`}>{status.replaceAll("_", " ")}</span>;
}

function TraceList() {
  const router = useRouter();
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJson<Summary[]>("/api/traces?limit=100").then(setRows).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="panel state"><h2>Could not load traces</h2><p>{error}</p></div>;
  if (!rows) return <div className="panel" style={{ padding: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}</div>;
  if (!rows.length)
    return (
      <div className="panel state">
        <h2>No runs yet</h2>
        <p>
          Every question asked on the <Link href="/">Ask</Link> page is saved here with its full trace.
        </p>
      </div>
    );
  return (
    <div className="panel" style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Question</th>
            <th scope="col">Status</th>
            <th scope="col" className="n">Steps</th>
            <th scope="col" className="n hide-sm">Tokens</th>
            <th scope="col" className="n hide-sm">Latency</th>
            <th scope="col" className="n hide-sm">Paid-rate cost</th>
            <th scope="col" className="hide-sm">Model</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.run_id} className="clickable" onClick={() => router.push(`/traces/?id=${r.run_id}`)}>
              <td className="num" style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>
                {new Date(r.created * 1000).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
              </td>
              <td className="q">
                <Link href={`/traces/?id=${r.run_id}`} onClick={(e) => e.stopPropagation()}>
                  {r.message || r.question}
                </Link>
              </td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td className="n">{r.steps ?? "–"}</td>
              <td className="n hide-sm">{r.total_tokens != null ? formatTokens(r.total_tokens) : "–"}</td>
              <td className="n hide-sm">{r.latency_ms != null ? formatMs(r.latency_ms) : "–"}</td>
              <td className="n hide-sm">{r.cost_usd != null ? `$${r.cost_usd.toFixed(4)}` : "–"}</td>
              <td className="mono hide-sm" style={{ color: "var(--text-3)" }}>{r.model}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function label(e: Trace["events"][number]): string {
  const d = e.data;
  switch (e.type) {
    case "run_started":
      return d.question;
    case "plan":
      return `${d.steps.length} steps: ${d.steps.join(" · ")}`;
    case "llm_call":
      return `${d.purpose} · ${d.input_tokens} in / ${d.output_tokens} out${d.thinking_tokens ? ` / ${d.thinking_tokens} thinking` : ""}${d.retries ? ` · ${d.retries} retries` : ""}`;
    case "tool_call":
      return `${d.tool}(${JSON.stringify(d.args).slice(0, 160)})`;
    case "tool_result":
      return `${d.tool} ${d.ok ? "ok" : "failed"}${d.error ? `: ${d.error}` : ""}`;
    case "assistant_note":
      return d.text;
    case "reflection":
      return `${d.kind}: ${d.message}`;
    case "waiting":
      return `${d.reason}, ${d.seconds} s`;
    case "clarification":
      return d.question;
    case "final":
      return d.answer;
    case "error":
      return d.message;
    case "run_finished":
      return `${d.status} · ${d.steps} ${d.steps === 1 ? "step" : "steps"} · ${d.llm_calls} model calls · ${formatTokens(d.total_tokens)} tokens`;
    default:
      return "";
  }
}

function duration(e: Trace["events"][number]): number {
  if (e.type === "llm_call") return e.data.latency_ms ?? 0;
  if (e.type === "tool_result") return e.data.latency_ms ?? 0;
  if (e.type === "waiting") return (e.data.seconds ?? 0) * 1000;
  return 0;
}

function TraceDetail({ id }: { id: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  useEffect(() => {
    getJson<Trace>(`/api/traces/${id}`).then(setTrace).catch((e) => setError(String(e)));
  }, [id]);

  const t0 = trace?.events[0]?.ts ?? 0;
  const total = useMemo(() => {
    if (!trace) return 1;
    const last = trace.events[trace.events.length - 1];
    return Math.max(1, (last.ts - t0) * 1000);
  }, [trace, t0]);

  if (error) return <div className="panel state"><h2>Trace not found</h2><p>{error}</p></div>;
  if (!trace) return <div className="panel" style={{ padding: 16 }}>{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</div>;
  const s = trace.summary;
  const llm = trace.events.filter((e) => e.type === "llm_call");
  const tools = trace.events.filter((e) => e.type === "tool_result");
  const failed = tools.filter((e) => !e.data.ok).length;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="result-caption" style={{ margin: "0 0 6px" }}>
            <Link href="/traces/">All traces</Link> / <span className="mono">{s.run_id}</span>
          </p>
          <h1>{s.message || s.question}</h1>
          <p className="sub">
            <StatusBadge status={s.status} /> <span className="mono">{s.provider} · {s.model}</span>
          </p>
        </div>
        <a className="btn secondary" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(trace, null, 1))}`} download={`quarry-trace-${s.run_id}.json`}>
          Download JSON
        </a>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="label">Latency</div>
          <div className="value num">{s.latency_ms != null ? formatMs(s.latency_ms) : "–"}</div>
        </div>
        <div className="stat">
          <div className="label">Model calls</div>
          <div className="value num">{llm.length}</div>
          <div className="vs">{formatTokens(s.total_tokens ?? 0)} tokens</div>
        </div>
        <div className="stat">
          <div className="label">Tool calls</div>
          <div className="value num">{tools.length}</div>
          <div className="vs">{failed} failed</div>
        </div>
        {s.provider === "ollama" ? (
          <div className="stat">
            <div className="label">Cost</div>
            <div className="value num">$0</div>
            <div className="vs">local model, no API cost</div>
          </div>
        ) : (
          <div className="stat">
            <div className="label">Cost at paid rates</div>
            <div className="value num">${(s.cost_usd ?? 0).toFixed(4)}</div>
            <div className="vs">actual cost $0 on the free tier</div>
          </div>
        )}
      </div>

      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Timeline</h2>
        <div className="legend" aria-hidden>
          <span><i style={{ background: "var(--series-1)" }} />Model call</span>
          <span><i style={{ background: "var(--series-2)" }} />Tool call</span>
          <span><i style={{ background: "var(--danger)" }} />Failed</span>
        </div>
      </div>
      <ol className="timeline panel">
        {trace.events.map((e, i) => {
          const dur = duration(e);
          const end = (e.ts - t0) * 1000;
          const start = Math.max(0, end - dur);
          const cls = e.type === "llm_call" ? "" : e.data.ok === false || e.type === "error" ? "err" : "tool";
          return (
            <li key={i} className="tl-row">
              <button type="button" className="tl-head" aria-expanded={!!open[i]} onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                <span className="tl-time">+{formatMs(end)}</span>
                <span className="tl-type">
                  <IconChevron width={12} height={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                  {e.type.replaceAll("_", " ")}
                </span>
                <span className="tl-label">{label(e)}</span>
                <span className="tl-bar" aria-hidden>
                  {dur > 0 && <span className={cls} style={{ left: `${(start / total) * 100}%`, width: `${(dur / total) * 100}%` }} />}
                </span>
              </button>
              {open[i] && (
                <div className="tl-body">
                  <pre>{JSON.stringify(e.data, null, 2)}</pre>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function TracesInner() {
  const params = useSearchParams();
  const id = params.get("id");
  return (
    <div className="page">
      {id ? (
        <TraceDetail id={id} />
      ) : (
        <>
          <div className="page-head">
            <div>
              <h1>Traces</h1>
              <p className="sub">
                Every run is recorded: the plan, each model call with tokens and latency, each tool call with its inputs,
                outputs and errors, and the cost at paid-tier rates.
              </p>
            </div>
          </div>
          <TraceList />
        </>
      )}
    </div>
  );
}

export default function TracesPage() {
  return (
    <Suspense fallback={<div className="page"><div className="skeleton" /></div>}>
      <TracesInner />
    </Suspense>
  );
}
