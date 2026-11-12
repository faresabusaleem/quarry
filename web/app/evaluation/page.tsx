"use client";

// Agent vs single-shot baseline, straight from evals/results (the same files the README cites).

import { Fragment, useEffect, useMemo, useState } from "react";

import { Sql } from "@/components/Code";
import { IconChevron } from "@/components/icons";
import { VegaChart } from "@/components/VegaChart";
import { getJson } from "@/lib/api";

type Metrics = Record<string, any>;
interface ItemRow {
  id: string;
  category: string;
  expect: string;
  question: string;
  outcome: string;
  success: boolean;
  failure: string | null;
  steps: number;
  latency_ms: number;
  exec_match: boolean | null;
  match_reason: string | null;
  sql: string | null;
  answer: string | null;
}
interface EvalRun {
  meta: { run: string; provider: string; model: string; items: number; started: string };
  summary: { agent?: Metrics; baseline?: Metrics };
  items: { agent: ItemRow[]; baseline: ItemRow[] };
}

const CATEGORY_ORDER = ["lookup", "aggregation", "join", "time_series", "multi_step", "followup", "ambiguous", "unsafe", "out_of_scope", "injection"];

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);

export default function EvaluationPage() {
  const [runs, setRuns] = useState<EvalRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runIdx, setRunIdx] = useState(0);
  const [system, setSystem] = useState<"agent" | "baseline">("agent");
  const [category, setCategory] = useState("all");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getJson<EvalRun[]>("/api/evals")
      .then((r) => {
        setRuns(r);
        setRunIdx(Math.max(0, r.length - 1));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const run = runs?.[runIdx];
  const a = useMemo<Metrics>(() => run?.summary.agent ?? {}, [run]);
  const b = useMemo<Metrics>(() => run?.summary.baseline ?? {}, [run]);

  const chartSpec = useMemo(() => {
    if (!run) return null;
    const cats = CATEGORY_ORDER.filter((c) => c in (a.by_category ?? {}) || c in (b.by_category ?? {}));
    const values = cats.flatMap((c) => [
      { category: c.replace("_", " "), system: "Quarry agent", success: a.by_category?.[c] ?? 0, items: a.by_category_n?.[c] ?? 0 },
      { category: c.replace("_", " "), system: "Baseline", success: b.by_category?.[c] ?? 0, items: b.by_category_n?.[c] ?? 0 },
    ]);
    return {
      data: { values },
      mark: { type: "bar" },
      height: { step: 13 },
      encoding: {
        y: { field: "category", type: "nominal", sort: cats.map((c) => c.replace("_", " ")), title: null },
        yOffset: { field: "system", sort: ["Quarry agent", "Baseline"] },
        x: { field: "success", type: "quantitative", title: "Task success", axis: { format: ".0%" }, scale: { domain: [0, 1] } },
        color: { field: "system", type: "nominal", title: null, sort: ["Quarry agent", "Baseline"] },
        tooltip: [
          { field: "category", type: "nominal" },
          { field: "system", type: "nominal" },
          { field: "success", type: "quantitative", format: ".0%" },
          { field: "items", type: "quantitative" },
        ],
      },
      width: "container",
    };
  }, [run, a, b]);

  if (error)
    return (
      <div className="page">
        <div className="panel state">
          <h2>Could not load evaluation results</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  if (!runs)
    return (
      <div className="page">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" />
        ))}
      </div>
    );
  if (!run)
    return (
      <div className="page">
        <div className="panel state">
          <h2>No evaluation results yet</h2>
          <p>
            Run <code>make eval</code> to score the agent and the baseline on the benchmark.
          </p>
        </div>
      </div>
    );

  const items = (run.items[system] ?? [])
    .filter((r) => category === "all" || r.category === category)
    .filter((r) => !onlyFailed || !r.success);
  const failures = Array.from(new Set([...Object.keys(a.failures ?? {}), ...Object.keys(b.failures ?? {})]));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Evaluation</h1>
          <p className="sub">
            {run.meta.items} benchmark questions with hand-written ground-truth SQL. The agent is compared with a
            single-shot text-to-SQL baseline (one model call, same schema and glossary, no tools, no retries) on the same
            model: <span className="mono">{run.meta.model}</span>.
          </p>
        </div>
        {runs.length > 1 && (
          <label className="toolbar" style={{ margin: 0 }}>
            Run
            <select value={runIdx} onChange={(e) => setRunIdx(Number(e.target.value))}>
              {runs.map((r, i) => (
                <option key={r.meta.run} value={i}>
                  {r.meta.run}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="stat-grid">
        {[
          ["Task success", a.task_success, b.task_success],
          ["Execution accuracy", a.execution_accuracy, b.execution_accuracy],
          ["Correct clarification", a.clarification_rate, b.clarification_rate],
          ["Correct refusal", a.refusal_rate, b.refusal_rate],
        ].map(([label, x, y]) => (
          <div className="stat" key={label as string}>
            <div className="label">{label as string}</div>
            <div className="value num">{pct(x as number)}</div>
            <div className="vs num">baseline {pct(y as number)}</div>
          </div>
        ))}
      </div>

      <section className="section">
        <h2>All metrics</h2>
        <div className="panel" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" className="n">Quarry agent</th>
                <th scope="col" className="n">Baseline</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Task success (all items)", pct(a.task_success), pct(b.task_success)],
                [`Execution accuracy (${a.n_gold ?? b.n_gold} items with gold SQL)`, pct(a.execution_accuracy), pct(b.execution_accuracy)],
                ["Recovery rate (a tool failed, run still succeeded)", `${pct(a.recovery_rate)} of ${a.n_failed_first ?? 0}`, "no retries"],
                ["Correct clarification", pct(a.clarification_rate), pct(b.clarification_rate)],
                ["Unnecessary clarification", pct(a.unnecessary_clarification_rate), pct(b.unnecessary_clarification_rate)],
                ["Correct refusal", pct(a.refusal_rate), pct(b.refusal_rate)],
                ["False refusal", pct(a.false_refusal_rate), pct(b.false_refusal_rate)],
                ["Injection resistance", pct(a.injection_resistance), `${pct(b.injection_resistance)} (never reads the text)`],
                ["Average steps", a.avg_steps ?? "–", b.avg_steps ?? "–"],
                ["Average model calls", a.avg_llm_calls ?? "–", b.avg_llm_calls ?? "–"],
                ["Average tokens", a.avg_tokens?.toLocaleString("en-US") ?? "–", b.avg_tokens?.toLocaleString("en-US") ?? "–"],
                ["Median latency", a.median_latency_s != null ? `${a.median_latency_s} s` : "–", b.median_latency_s != null ? `${b.median_latency_s} s` : "–"],
                ["Paid-rate cost, whole benchmark", `$${(a.total_paid_equivalent_usd ?? 0).toFixed(4)}`, `$${(b.total_paid_equivalent_usd ?? 0).toFixed(4)}`],
              ].map(([m, x, y]) => (
                <tr key={m as string}>
                  <td>{m}</td>
                  <td className="n strong">{x}</td>
                  <td className="n">{y}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Success by category</h2>
        <div className="panel" style={{ padding: "12px 16px" }}>
          {chartSpec && <VegaChart spec={chartSpec} label="Task success by category for the agent and the baseline" />}
        </div>
      </section>

      {failures.length > 0 && (
        <section className="section">
          <h2>Failure types</h2>
          <div className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Failure</th>
                  <th scope="col" className="n">Agent</th>
                  <th scope="col" className="n">Baseline</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f}>
                    <td>{f.replaceAll("_", " ")}</td>
                    <td className="n">{a.failures?.[f] ?? 0}</td>
                    <td className="n">{b.failures?.[f] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Every item</h2>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="System">
            {(["agent", "baseline"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={system === s} onClick={() => setSystem(s)}>
                {s === "agent" ? "Quarry agent" : "Baseline"}
              </button>
            ))}
          </div>
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> Failures only
          </label>
          <span className="result-caption" style={{ margin: 0 }}>
            {items.length} items
          </span>
        </div>
        <div className="panel" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Question</th>
                <th scope="col">Result</th>
                <th scope="col" className="hide-sm">Outcome</th>
                <th scope="col" className="n hide-sm">Steps</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="mono">
                      <button type="button" className="link-btn" aria-expanded={open === r.id} style={{ color: "var(--text)" }}>
                        <IconChevron width={12} height={12} style={{ verticalAlign: -2 }} /> {r.id}
                      </button>
                    </td>
                    <td className="q">{r.question}</td>
                    <td>
                      <span className={`badge ${r.success ? "ok" : "bad"}`}>{r.success ? "pass" : (r.failure ?? "fail").replaceAll("_", " ")}</span>
                    </td>
                    <td className="hide-sm">{r.outcome}</td>
                    <td className="n hide-sm">{r.steps}</td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--surface-2)" }}>
                        <div style={{ display: "grid", gap: 8, maxWidth: 900 }}>
                          <div>
                            <b>Expected:</b> {r.expect}
                            {r.match_reason && (
                              <>
                                {" "}
                                · <b>Scorer:</b> {r.match_reason}
                              </>
                            )}
                          </div>
                          {r.answer && (
                            <div>
                              <b>{system === "agent" ? "Answer" : "Message"}:</b> {r.answer}
                            </div>
                          )}
                          {r.sql && <Sql code={r.sql} />}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
