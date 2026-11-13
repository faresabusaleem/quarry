"use client";

// The trace viewer: every run the server handled, and for one run a waterfall of each model
// call, tool call and wait with its inputs, outputs, tokens, latency and cost.

import { ArrowLeft, ChevronRight, CircleAlert, Clock3, Coins, Cpu, Hash, Timer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { AnswerText } from "@/components/chat/Answer";
import { PlainBlock, SqlBlock } from "@/components/chat/Code";
import { ResultTable } from "@/components/chat/ResultTable";
import { TOOLS } from "@/components/chat/StepCard";
import { getJson } from "@/lib/api";
import { formatMs, formatTokens } from "@/lib/run";
import { duration } from "@/lib/summary";
import { buildSpans, ticks, type Span, type TraceEvent } from "@/lib/timeline";

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
  events: TraceEvent[];
}

const STATUS: Record<string, string> = { answered: "ok", refused: "plain", clarify: "plain", stopped: "bad", error: "bad", budget_exhausted: "warn" };

function Status({ status }: { status: string }) {
  return <span className={`badge ${STATUS[status] ?? "plain"}`}>{status.replaceAll("_", " ")}</span>;
}

function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

function TraceList() {
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJson<Summary[]>("/api/traces?limit=100")
      .then(setRows)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="page">
      <PageHead title="Traces">
        <p className="page-lead">
          Every run this server has handled, newest first: each model call and tool call with its inputs, outputs, tokens, latency and cost. On the hosted demo
          traces live in temporary storage, so they disappear when the server instance restarts.
        </p>
      </PageHead>
      {error ? (
        <div className="notice danger" role="alert">
          <CircleAlert aria-hidden />
          <div>
            <h3>Could not load traces</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : !rows ? (
        <div className="panel pad">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}</div>
      ) : !rows.length ? (
        <div className="empty-state">
          <h2>No runs on this server yet</h2>
          <p>
            Ask a question in <Link href="/app/">Analysis</Link> and its full trace appears here.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table trace-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Status</th>
                <th scope="col" className="n">
                  Steps
                </th>
                <th scope="col" className="n hide-sm">
                  Time
                </th>
                <th scope="col" className="n hide-sm">
                  Tokens
                </th>
                <th scope="col" className="hide-md">
                  Model
                </th>
                <th scope="col" className="n hide-sm">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.run_id}>
                  <td className="q">
                    <Link href={`/app/traces/?id=${r.run_id}`}>{r.message || r.question}</Link>
                  </td>
                  <td>
                    <Status status={r.status} />
                  </td>
                  <td className="n">{r.steps ?? "–"}</td>
                  <td className="n hide-sm">{r.latency_ms != null ? duration(r.latency_ms) : "–"}</td>
                  <td className="n hide-sm">{r.total_tokens != null ? formatTokens(r.total_tokens) : "–"}</td>
                  <td className="mono hide-md muted">{r.model}</td>
                  <td className="n hide-sm muted">{new Date(r.created * 1000).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SpanDetail({ span }: { span: Span }) {
  if (span.kind === "llm") {
    const d = span.result!.data;
    return (
      <dl className="kv">
        <dt>Purpose</dt>
        <dd>{d.purpose}</dd>
        <dt>Tokens</dt>
        <dd className="mono">
          {d.input_tokens} in · {d.output_tokens} out{d.thinking_tokens ? ` · ${d.thinking_tokens} thinking` : ""}
        </dd>
        <dt>Latency</dt>
        <dd className="mono">{formatMs(d.latency_ms ?? 0)}</dd>
        {d.retries ? (
          <>
            <dt>Retries</dt>
            <dd className="mono">{d.retries}</dd>
          </>
        ) : null}
        {d.cost_usd != null && (
          <>
            <dt>Paid-rate cost</dt>
            <dd className="mono">${Number(d.cost_usd).toFixed(6)}</dd>
          </>
        )}
        <dt>Model</dt>
        <dd className="mono">{d.model}</dd>
      </dl>
    );
  }
  if (span.kind === "wait") return <p className="muted">The client waited {span.detail} before the next model request.</p>;
  const args = span.call?.data?.args ?? {};
  const r = span.result?.data ?? {};
  const data = r.data ?? {};
  const { sql, code, ...rest } = args;
  return (
    <div className="span-detail">
      <p className="block-label">Input</p>
      {sql ? <SqlBlock code={String(sql)} /> : null}
      {code ? <PlainBlock code={String(code)} label="Python" /> : null}
      {Object.keys(rest).length > 0 && <PlainBlock code={JSON.stringify(rest, null, 2)} label="Arguments" />}
      <p className="block-label">Output</p>
      {!r.ok ? (
        <div className="step-error">
          <p className="step-error-title">{data.blocked ? "Blocked by the SQL guard" : "Error"}</p>
          <p className="mono">{r.error}</p>
          {span.reflection && <p className="step-error-next">{span.reflection}</p>}
        </div>
      ) : data.columns?.length && Array.isArray(data.rows) && typeof data.columns[0] === "string" ? (
        <ResultTable columns={data.columns} rows={data.rows} limit={10} total={data.row_count} truncated={data.truncated} caption="Tool output" />
      ) : (
        <PlainBlock code={String(r.content ?? "").slice(0, 4000)} label="Tool output" />
      )}
    </div>
  );
}

function Waterfall({ spans, totalMs }: { spans: Span[]; totalMs: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const axis = ticks(totalMs);
  const pct = (v: number) => `${(v / Math.max(totalMs, 1)) * 100}%`;
  return (
    <div className="waterfall" role="table" aria-label="Run timeline">
      <div className="wf-row wf-axis" role="row" aria-hidden>
        <span className="wf-label" />
        <span className="wf-track">
          {axis.map((t) => (
            <span key={t} className="wf-tick" style={{ left: pct(t) }}>
              {axis[axis.length - 1] >= 1000 ? `${t / 1000} s` : `${t} ms`}
            </span>
          ))}
        </span>
      </div>
      {spans.map((s) => {
        const meta = s.kind === "tool" ? TOOLS[s.label] : undefined;
        const isOpen = open === s.id;
        return (
          <div key={s.id} className={`wf-item ${isOpen ? "is-open" : ""}`} role="rowgroup">
            <button type="button" className={`wf-row kind-${s.kind} ${s.ok ? "" : "is-error"}`} role="row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
              <span className="wf-label" role="cell">
                <ChevronRight className="chev" aria-hidden />
                <span className="wf-name">{meta?.label ?? (s.kind === "tool" ? s.label.replaceAll("_", " ") : s.label)}</span>
                <span className="wf-detail">{s.detail}</span>
              </span>
              <span className="wf-track" role="cell">
                {axis.map((t) => (
                  <span key={t} className="wf-grid" style={{ left: pct(t) }} aria-hidden />
                ))}
                <span className="wf-bar" style={{ left: pct(s.startMs), width: `max(3px, ${pct(s.durationMs)})` }} />
                <span className="wf-time mono">{formatMs(s.durationMs)}</span>
              </span>
            </button>
            {isOpen && (
              <div className="wf-body">
                <SpanDetail span={s} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TraceDetail({ id }: { id: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    getJson<Trace>(`/api/traces/${id}`)
      .then(setTrace)
      .catch((e) => setError(String(e)));
  }, [id]);
  const built = useMemo(() => (trace ? buildSpans(trace.events) : null), [trace]);

  const back = (
    <Link href="/app/traces/" className="back-link">
      <ArrowLeft aria-hidden /> All traces
    </Link>
  );
  if (error)
    return (
      <div className="page">
        {back}
        <div className="empty-state">
          <h2>This trace is not available</h2>
          <p>
            Run <span className="mono">{id}</span> is not stored on this server. The hosted demo keeps traces only while its server instance is running, so links to them
            expire.
          </p>
        </div>
      </div>
    );
  if (!trace || !built)
    return (
      <div className="page">
        {back}
        <div className="panel pad">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}</div>
      </div>
    );

  const s = trace.summary;
  const finished = trace.events.find((e) => e.type === "run_finished")?.data ?? {};
  const usage = finished.usage ?? {};
  const plan = trace.events.find((e) => e.type === "plan")?.data?.steps as string[] | undefined;
  const final = trace.events.find((e) => e.type === "final")?.data;
  const tools = built.spans.filter((x) => x.kind === "tool");
  const llm = built.spans.filter((x) => x.kind === "llm");
  const local = s.provider === "ollama";

  return (
    <div className="page">
      {back}
      <header className="page-head trace-head">
        <div className="trace-badges">
          <Status status={s.status} />
          <span className="badge plain mono">{s.model}</span>
          <span className="badge plain mono">{s.run_id}</span>
        </div>
        <h1 className="trace-title">{s.message || s.question}</h1>
        <p className="muted">{new Date(s.created * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
      </header>

      <dl className="stats">
        <div>
          <dt>
            <Timer aria-hidden /> Duration
          </dt>
          <dd>{duration(s.latency_ms ?? built.totalMs)}</dd>
        </div>
        <div>
          <dt>
            <Cpu aria-hidden /> Model calls
          </dt>
          <dd>{llm.length}</dd>
        </div>
        <div>
          <dt>
            <Hash aria-hidden /> Tool calls
          </dt>
          <dd>
            {tools.length}
            {tools.some((t) => !t.ok) && <span className="stat-note">{tools.filter((t) => !t.ok).length} failed</span>}
          </dd>
        </div>
        <div>
          <dt>
            <Clock3 aria-hidden /> Tokens
          </dt>
          <dd>
            {formatTokens(s.total_tokens ?? 0)}
            {usage.input_tokens != null && (
              <span className="stat-note">
                {formatTokens(usage.input_tokens)} in, {formatTokens(usage.output_tokens ?? 0)} out
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>
            <Coins aria-hidden /> Cost
          </dt>
          <dd>
            {local ? "$0" : `$${(s.cost_usd ?? 0).toFixed(4)}`}
            <span className="stat-note">{local ? "Local model" : "At paid rates. $0 on the free tier"}</span>
          </dd>
        </div>
      </dl>

      <section className="section">
        <h2 className="section-title">Timeline</h2>
        <Waterfall spans={built.spans} totalMs={built.totalMs} />
      </section>

      {plan && (
        <section className="section">
          <h2 className="section-title">Plan</h2>
          <ol className="plain-list">
            {plan.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </section>
      )}

      {final && (
        <section className="section">
          <h2 className="section-title">Answer</h2>
          <div className="panel pad">
            <AnswerText text={final.answer} citations={final.citations ?? []} onCite={() => {}} />
          </div>
        </section>
      )}

      <section className="section">
        <button type="button" className="btn btn-secondary btn-sm" aria-expanded={raw} onClick={() => setRaw((r) => !r)}>
          {raw ? "Hide" : "Show"} the raw events ({trace.events.length})
        </button>
        {raw && <PlainBlock code={JSON.stringify(trace.events, null, 2).slice(0, 200_000)} label="Raw trace events" />}
      </section>
    </div>
  );
}

function Traces() {
  const id = useSearchParams().get("id");
  return id && /^[a-z0-9]+$/i.test(id) ? <TraceDetail id={id} /> : <TraceList />;
}

export default function TracesPage() {
  return (
    <Suspense fallback={null}>
      <Traces />
    </Suspense>
  );
}
