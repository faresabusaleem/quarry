"use client";

// Agent vs single-shot baseline. Headline numbers, charts and the written analysis come from
// web/lib/generated (exported from evals/results); per-question rows load from /api/evals.

import { ChevronRight, CircleAlert } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

import { GroupedBars } from "@/components/charts/GroupedBars";
import { SqlBlock } from "@/components/chat/Code";
import { Markdown } from "@/components/Markdown";
import { getJson } from "@/lib/api";
import analysis from "@/lib/generated/analysis.json";
import results from "@/lib/generated/results.json";

type Metrics = Record<string, any>;
interface Run {
  run: string;
  set: string;
  commit: string;
  model: string;
  items: number;
  agent: Metrics;
  baseline: Metrics;
  discordant: { agent_only: number; baseline_only: number; p: number };
}
const RUNS = results.runs as unknown as Record<string, Run>;

interface Item {
  id: string;
  category: string;
  expect: string;
  question: string;
  outcome: string;
  success: boolean;
  failure: string | null;
  steps: number;
  latency_ms: number;
  match_reason: string | null;
  sql: string | null;
  answer: string | null;
}
interface EvalRun {
  meta: { run: string };
  items: { agent: Item[]; baseline: Item[] };
}

const CATEGORIES = ["lookup", "aggregation", "join", "time_series", "multi_step", "followup", "ambiguous", "unsafe", "out_of_scope", "injection"];
const CAT_LABEL: Record<string, string> = {
  lookup: "Lookups",
  aggregation: "Aggregations",
  join: "Joins",
  time_series: "Time series",
  multi_step: "Multi-step analysis",
  followup: "Follow-up questions",
  ambiguous: "Ambiguous questions",
  unsafe: "Unsafe requests",
  out_of_scope: "Out of scope",
  injection: "Prompt injection in the data",
};
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const secs = (x: number | null | undefined) => (x == null ? "–" : `${x.toFixed(1)} s`);

function MetricTable({ a, b }: { a: Metrics; b: Metrics }) {
  const rows: [string, string, string][] = [
    ["Task success", pct(a.task_success), pct(b.task_success)],
    ["Execution accuracy (questions with gold SQL)", pct(a.execution_accuracy), pct(b.execution_accuracy)],
    ["Answers whose every figure matched a query result", pct(a.grounded_answer_rate), "n/a (returns a table)"],
    ["Still succeeded after a query failed", `${pct(a.sql_recovery_rate)} of ${a.n_sql_failed}`, `${pct(b.sql_recovery_rate)} of ${b.n_sql_failed} (no retries)`],
    ["Asked when the question was ambiguous", pct(a.clarification_rate), pct(b.clarification_rate)],
    ["Asked when it did not need to", pct(a.unnecessary_clarification_rate), pct(b.unnecessary_clarification_rate)],
    ["Refused unsafe or out-of-scope requests", pct(a.refusal_rate), pct(b.refusal_rate)],
    ["Refused a fair question", pct(a.false_refusal_rate), pct(b.false_refusal_rate)],
    ["Ignored instructions planted in the data", pct(a.injection_resistance), pct(b.injection_resistance)],
    ["Forbidden queries attempted (writes, file reads)", String(a.unsafe_sql_blocked ?? "–"), String(b.unsafe_sql_blocked ?? "–")],
    ["Median time per question", secs(a.median_latency_s), secs(b.median_latency_s)],
    ["Average model calls per question", String(a.avg_llm_calls ?? "–"), String(b.avg_llm_calls ?? "–")],
    ["Average tokens per question", (a.avg_tokens ?? 0).toLocaleString("en-US"), (b.avg_tokens ?? 0).toLocaleString("en-US")],
  ];
  return (
    <div className="table-wrap">
      <table className="table metric-table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col" className="n">
              Quarry agent
            </th>
            <th scope="col" className="n">
              Baseline
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, x, y]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td className="n">{x}</td>
              <td className="n">{y}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Items({ runName }: { runName: string }) {
  const [runs, setRuns] = useState<EvalRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState<"agent" | "baseline">("agent");
  const [category, setCategory] = useState("all");
  const [failedOnly, setFailedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    getJson<EvalRun[]>("/api/evals")
      .then(setRuns)
      .catch((e) => setError(String(e)));
  }, []);
  const items = useMemo(() => {
    const run = runs?.find((r) => r.meta.run === runName);
    return (run?.items[system] ?? []).filter((i) => (category === "all" || i.category === category) && (!failedOnly || !i.success));
  }, [runs, runName, system, category, failedOnly]);

  if (error)
    return (
      <div className="notice danger" role="alert">
        <CircleAlert aria-hidden />
        <div>
          <h3>Could not load the per-question results</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  return (
    <>
      <div className="filters" role="group" aria-label="Filter questions">
        <div className="segmented" role="radiogroup" aria-label="System">
          {(["agent", "baseline"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={system === s} onClick={() => setSystem(s)}>
              {s === "agent" ? "Quarry agent" : "Baseline"}
            </button>
          ))}
        </div>
        <label className="select">
          <span className="visually-hidden">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CAT_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed only
        </label>
        <span className="muted filters-count">{runs ? `${items.length} questions` : ""}</span>
      </div>
      {!runs ? (
        <div className="panel pad">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}</div>
      ) : (
        <div className="table-wrap">
          <table className="table items-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col" className="hide-sm">
                  Category
                </th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const isOpen = open === i.id;
                return (
                  <Fragment key={i.id}>
                    <tr>
                      <td>
                        <button type="button" className="item-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.id)}>
                          <ChevronRight className="chev" aria-hidden />
                          <span className="mono item-id">{i.id}</span>
                          <span>{i.question}</span>
                        </button>
                      </td>
                      <td className="hide-sm muted">{CAT_LABEL[i.category] ?? i.category}</td>
                      <td>
                        <span className={`badge ${i.success ? "ok" : "bad"}`}>{i.success ? "Pass" : "Fail"}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="item-detail">
                        <td colSpan={3}>
                          <dl className="kv">
                            <dt>Expected</dt>
                            <dd>{i.expect}</dd>
                            <dt>Outcome</dt>
                            <dd>{i.outcome}</dd>
                            {i.failure && (
                              <>
                                <dt>Why it failed</dt>
                                <dd>{i.failure.replaceAll("_", " ")}</dd>
                              </>
                            )}
                            {i.match_reason && (
                              <>
                                <dt>Scoring</dt>
                                <dd>{i.match_reason}</dd>
                              </>
                            )}
                            <dt>Steps · time</dt>
                            <dd className="mono">
                              {i.steps} · {(i.latency_ms / 1000).toFixed(1)} s
                            </dd>
                          </dl>
                          {i.sql && <SqlBlock code={i.sql} label="SQL it used" />}
                          {i.answer && <p className="item-answer">{i.answer.replace(/\[[na]\d+\]/g, "").slice(0, 900)}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function BenchmarkPage() {
  const [set, setSet] = useState<"dev" | "heldout">("dev");
  const run = RUNS[`v3-${set}`];
  const before = RUNS[`v1-${set}`];
  const a = run.agent;
  const b = run.baseline;
  const groups = CATEGORIES.filter((c) => c in (a.by_category ?? {})).map((c) => ({
    label: CAT_LABEL[c],
    note: `${a.by_category_n[c]} ${a.by_category_n[c] === 1 ? "question" : "questions"}`,
    values: { agent: a.by_category[c], baseline: b.by_category[c] },
  }));
  const d = run.discordant;

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Measured, not claimed</p>
        <h1>Benchmark</h1>
        <p className="page-lead">
          Quarry&apos;s agent against the simplest thing that could work: single-shot text-to-SQL with the same model ({run.model}, run locally), the same schema
          notes and the same business glossary. Ground truth is SQL written by hand. Every number here comes from the result files in{" "}
          <a href="https://github.com/faresabusaleem/quarry/tree/main/evals/results" target="_blank" rel="noreferrer">
            evals/results
          </a>
          .
        </p>
      </header>

      <div className="segmented set-switch" role="radiogroup" aria-label="Question set">
        <button type="button" role="radio" aria-checked={set === "dev"} onClick={() => setSet("dev")}>
          Main set · {RUNS["v3-dev"].items} questions
        </button>
        <button type="button" role="radio" aria-checked={set === "heldout"} onClick={() => setSet("heldout")}>
          Held-out · {RUNS["v3-heldout"].items} questions
        </button>
      </div>
      <p className="set-note muted">
        {set === "dev"
          ? "Prompts and glossary were tuned twice against this set, so it flatters both systems."
          : "Written after the code was frozen and never used for tuning: the fairer test, and a small one."}{" "}
        Code version <span className="mono">{run.commit}</span>.
      </p>

      <dl className="stats stats-lg">
        <div>
          <dt>Task success, agent</dt>
          <dd>{pct(a.task_success)}</dd>
          <dd className="stat-sub">Baseline {pct(b.task_success)}</dd>
        </div>
        <div>
          <dt>Only one system solved</dt>
          <dd>
            {d.agent_only} <span className="vs">vs</span> {d.baseline_only}
          </dd>
          <dd className="stat-sub">Agent vs baseline. McNemar p = {d.p.toFixed(2)}: not significant</dd>
        </div>
        <div>
          <dt>Answers fully verified</dt>
          <dd>{pct(a.grounded_answer_rate)}</dd>
          <dd className="stat-sub">Up from {pct(before.agent.grounded_answer_rate)} in v1, by checking figures in code</dd>
        </div>
        <div>
          <dt>Median time per question</dt>
          <dd>{secs(a.median_latency_s)}</dd>
          <dd className="stat-sub">Baseline {secs(b.median_latency_s)}</dd>
        </div>
      </dl>

      <section className="section">
        <h2 className="section-title">Task success by category</h2>
        <p className="section-lead muted">The two systems fail differently: the baseline is better at questions one query can answer, the agent at ambiguity, recovery and text in the data.</p>
        <GroupedBars
          caption={`Task success by category on the ${set === "dev" ? "main" : "held-out"} set`}
          series={[
            { key: "agent", label: "Quarry agent", color: "var(--series-2)" },
            { key: "baseline", label: "Baseline", color: "var(--series-1)" },
          ]}
          groups={groups}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Every metric</h2>
        <MetricTable a={a} b={b} />
      </section>

      <section className="section">
        <h2 className="section-title">v1 to v3</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col" className="n">
                  Agent
                </th>
                <th scope="col" className="n">
                  Baseline
                </th>
                <th scope="col" className="n">
                  Verified answers
                </th>
                <th scope="col" className="n hide-sm">
                  Median time
                </th>
              </tr>
            </thead>
            <tbody>
              {(set === "dev" ? ["v1-dev", "v2-dev", "v3-dev"] : ["v1-heldout", "v3-heldout"]).map((k) => (
                <tr key={k}>
                  <th scope="row">
                    {k.split("-")[0]} <span className="mono muted">{RUNS[k].commit}</span>
                  </th>
                  <td className="n">{pct(RUNS[k].agent.task_success)}</td>
                  <td className="n">{pct(RUNS[k].baseline.task_success)}</td>
                  <td className="n">{pct(RUNS[k].agent.grounded_answer_rate)}</td>
                  <td className="n hide-sm">{secs(RUNS[k].agent.median_latency_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Every question</h2>
        <Items runName={run.run} />
      </section>

      <section className="section">
        <h2 className="section-title">Error analysis</h2>
        <Markdown source={(set === "dev" ? analysis.dev : analysis.heldout).replace(/^## .*\n/, "")} headingOffset={0} />
      </section>

      <section className="section">
        <h2 className="section-title">Limitations</h2>
        <Markdown source={analysis.limitations} headingOffset={0} />
      </section>
    </div>
  );
}
