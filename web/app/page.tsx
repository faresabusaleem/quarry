import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/brand/Logo";
import { highlightSql } from "@/lib/sql";
import { AskBox } from "@/components/landing/AskBox";
import { HeroRun } from "@/components/landing/HeroRun";
import { McpSwitch } from "@/components/landing/McpSwitch";
import { Reveal } from "@/components/landing/Reveal";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { AgentEvent, FinalData } from "@/lib/api";
import recovery from "@/lib/generated/recovery.json";
import results from "@/lib/generated/results.json";
import showcase from "@/lib/generated/showcase-trace.json";
import { applyEvent, newTurn } from "@/lib/run";
import { stagesFromTrace, type StageKey } from "@/lib/stages";
import { workSummary } from "@/lib/summary";
import type { TraceEvent } from "@/lib/timeline";
import "./landing.css";

export const metadata: Metadata = {
  title: { absolute: "Quarry: an AI analyst that shows its work" },
  alternates: { canonical: "/" },
};

const GITHUB = "https://github.com/faresabusaleem/quarry";

// ---- everything below is computed from real files at build time
const events = showcase.events as unknown as TraceEvent[];
let turn = newTurn(String(events[0].data.question));
for (const e of events) turn = applyEvent(turn, e as unknown as AgentEvent);
const final = turn.final as FinalData;
const runSummary = workSummary(turn);
const model = String(events[0].data.model);
const stages = stagesFromTrace(events);
const totalS = stages.reduce((a, s) => a + s.ms, 0) / 1000;

type Run = { items: number; agent: Record<string, any>; baseline: Record<string, any>; discordant: { p: number; agent_only: number; baseline_only: number } };
const runs = results.runs as unknown as Record<string, Run>;
const dev = runs["v3-dev"];
const held = runs["v3-heldout"];
const v1 = runs["v1-dev"];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const example = results.examples[0].question;

const STAGE: Record<StageKey, { name: string; clause: string }> = {
  plan: { name: "Plan", clause: "Plans the analysis before it touches the data." },
  explore: { name: "Explore", clause: "Reads the tables it needs, with what each column means." },
  query: { name: "Query", clause: "Writes SQL, has it checked, and runs it read-only." },
  chart: { name: "Chart", clause: "Draws the result when a picture says it faster." },
  answer: { name: "Answer", clause: "Answers, and every figure must match a query result." },
};
const seconds = (ms: number) => {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} seconds` : `${Math.round(s)} seconds`;
};

function Stone() {
  // The Facet, enormous: the hero's stage. Same geometry as the icon (docs/brand.md).
  return (
    <svg className="stone" viewBox="18 12 84 96" aria-hidden preserveAspectRatio="xMinYMin meet">
      <polygon points="60,12 102,36 102,84 60,108 18,84 18,36" fill="var(--logo-body)" />
      <polygon className="stone-facet" points="60,12 102,36 60,60" fill="var(--logo-facet)" />
      <polygon className="stone-glint" points="60,12 102,36 60,60" />
      <path d="M60 60L18 36M60 60L60 108M60 60L102 84" stroke="var(--logo-lines)" strokeWidth={0.6} fill="none" />
    </svg>
  );
}

export default function Home() {
  const failedSql = String(recovery.failed.args.sql ?? "").trim();
  const fixedSql = String(recovery.fixed.args.sql ?? "").trim();
  return (
    <>
      <Reveal />
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <header className="site-nav">
        <Link href="/" className="site-logo" aria-label="Quarry home">
          <Logo height={24} />
        </Link>
        <nav aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#safety">Safety</a>
          <a href="#results">Results</a>
          <a href="#mcp">MCP</a>
          <a href={GITHUB}>GitHub</a>
        </nav>
        <div className="site-nav-end">
          <ThemeToggle />
          <Link href="/app/" className="btn btn-primary">
            Try the demo
          </Link>
        </div>
      </header>

      <main id="top">
        {/* ------------------------------------------------ hero */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-text">
            <h1 id="hero-title" data-reveal>
              An analyst that shows its work
            </h1>
            <p className="hero-sub" data-reveal>
              Ask a question in plain English. Quarry plans the analysis, writes and checks its own SQL on 99,441 real marketplace orders, and links every
              number in its answer to the query behind it.
            </p>
            <div className="hero-actions" data-reveal>
              <Link href="/app/" className="btn btn-primary btn-lg">
                Try the demo <ArrowRight aria-hidden />
              </Link>
              <a href={GITHUB} className="btn btn-secondary btn-lg">
                View on GitHub <ArrowUpRight aria-hidden />
              </a>
            </div>
            <p className="hero-note" data-reveal>
              This run is real: {model}, {seconds(totalS * 1000)} from question to answer. Click a number to see its query.
            </p>
          </div>
          <div className="hero-stage">
            <Stone />
            <div className="hero-fragment">
              <HeroRun question={turn.message} summary={runSummary} final={final} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ how it works */}
        <section id="how" className="how" aria-labelledby="how-title">
          <h2 id="how-title" data-reveal>
            It works like an analyst
          </h2>
          <p className="how-lead" data-reveal>
            The same run, stage by stage. Each block is as wide as that stage really took: {seconds(totalS * 1000)} from question to checked answer.
          </p>
          <ol className="stage-bar" data-ui data-reveal>
            {stages.map((s) => (
              <li key={s.key} className={`stage stage-${s.key}`} style={{ flexGrow: Math.max(s.ms, totalS * 1000 * 0.12) }}>
                <span className="stage-block">
                  <span className="stage-time">{seconds(s.ms)}</span>
                </span>
                <span className="stage-name">{STAGE[s.key].name}</span>
                <span className="stage-clause">{STAGE[s.key].clause}</span>
              </li>
            ))}
          </ol>

          <div className="recover" data-reveal>
            <div className="recover-text">
              <h3>And when a query fails, it recovers</h3>
              <p>
                In another real run the SQL guard blocked a query that read from an earlier result as if it were a table. The agent read the error, rewrote the
                query from the base tables, and carried on.
              </p>
            </div>
            <ol className="recover-steps" data-ui>
              <li className="rstep is-error">
                <p className="rstep-head">
                  <CircleAlert aria-hidden /> <b>Run SQL</b> <span>{String(recovery.failed.args.purpose ?? "")}</span>
                  <em className="tag tag-error">Failed</em>
                </p>
                <pre className="ui-sql">
                  <code>{highlightSql(failedSql)}</code>
                </pre>
                <p className="rstep-error">
                  <code>{recovery.error}</code>
                </p>
              </li>
              <li className="rstep">
                <p className="rstep-head">
                  <CircleCheck aria-hidden /> <b>Run SQL</b> <span>{String(recovery.fixed.args.purpose ?? "")}</span>
                  <em className="tag tag-fixed">Fixed</em>
                </p>
                <pre className="ui-sql">
                  <code>{highlightSql(fixedSql.split("\n").slice(0, 7).join("\n") + "\n  …")}</code>
                </pre>
                <p className="rstep-ok">
                  <code>{String(recovery.result.content ?? "").split("\n")[0]}</code>
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------ safety */}
        <section id="safety" className="safety" aria-labelledby="safety-title">
          <div className="board">
            <div className="tile t-head" data-reveal>
              <h2 id="safety-title">Safe by construction</h2>
              <p>Not a promise in a prompt: each guard is code that runs whatever the model says.</p>
            </div>
            <div className="tile t-big t-dark" data-reveal>
              <div className="tile-ui" data-ui>
                <pre>
                  <code>
                    {"duckdb.connect(path,\n  read_only="}
                    <b>True</b>
                    {",\n  enable_external_access="}
                    <b>False</b>
                    {")\nSET lock_configuration = "}
                    <b>true</b>
                  </code>
                </pre>
              </div>
              <p className="tile-cap">
                <b>Read-only at the engine</b>
                <span>Writes, file reads and setting changes are impossible, not discouraged.</span>
              </p>
            </div>
            <div className="tile t-wide" data-reveal>
              <div className="tile-ui" data-ui>
                <span className="tag tag-error big-tag">Blocked by the SQL guard</span>
              </div>
              <p className="tile-cap">
                <b>Every query is checked first</b>
                <span>One SELECT, known tables only, a row cap and a time limit.</span>
              </p>
            </div>
            <div className="tile t-tall t-fill" data-reveal>
              <div className="tile-ui" data-ui>
                <code className="fence">
                  &lt;&lt;&lt;DATA reviews&gt;&gt;&gt;
                  <br />
                  …ignore your rules…
                  <br />
                  &lt;&lt;&lt;END DATA&gt;&gt;&gt;
                </code>
              </div>
              <p className="tile-cap">
                <b>Data stays data</b>
                <span>Text from the database is fenced as untrusted. No planted instruction was ever followed.</span>
              </p>
            </div>
            <div className="tile t-small" data-reveal>
              <div className="tile-ui" data-ui>
                <span className="cite big-cite">
                  <span className="cite-value">23.9%</span>
                  <span className="cite-src">q1</span>
                </span>
              </div>
              <p className="tile-cap">
                <b>Every figure checked</b>
                <span>A number that matches no result sends the answer back.</span>
              </p>
            </div>
            <div className="tile t-wide t-fill" data-reveal>
              <div className="tile-ui" data-ui>
                <code className="sandbox">network: none · 10 s · 512 MB</code>
              </div>
              <p className="tile-cap">
                <b>Python in a sandbox</b>
                <span>A separate process with no network. Off on the hosted demo, which cannot isolate it.</span>
              </p>
            </div>
            <div className="tile t-small t-fill" data-reveal>
              <div className="tile-ui" data-ui>
                <span className="reply-chip big-chip">By revenue</span>
                <span className="reply-chip big-chip">By orders</span>
              </div>
              <p className="tile-cap">
                <b>Asks when it should</b>
                <span>Ambiguous questions get a question back.</span>
              </p>
            </div>
            <div className="tile t-wide" data-reveal>
              <div className="tile-ui" data-ui>
                <span className="stopped">Stopped after the same error twice</span>
              </div>
              <p className="tile-cap">
                <b>Knows when to stop</b>
                <span>Step, token and time budgets, and no third try at the same mistake.</span>
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ results */}
        <section id="results" className="results" aria-labelledby="results-title">
          <div className="marks">
            <div className="mark m-head" data-reveal>
              <h2 id="results-title">Measured, not claimed</h2>
              <p>
                Against single-shot text-to-SQL with the same local model, schema and glossary, on questions with hand-written gold SQL. Every question,
                metric and failure is in <Link href="/app/benchmark/">the benchmark</Link>, with the error analysis.
              </p>
            </div>
            <div className="mark" data-reveal>
              <p className="mark-num">
                {pct(dev.agent.task_success)} <span>vs {pct(dev.baseline.task_success)}</span>
              </p>
              <p className="mark-cap">Task success, agent vs baseline, on {dev.items} questions</p>
            </div>
            <div className="mark" data-reveal>
              <p className="mark-num">
                {pct(held.agent.task_success)} <span>vs {pct(held.baseline.task_success)}</span>
              </p>
              <p className="mark-cap">On {held.items} held-out questions written after the code freeze</p>
            </div>
            <div className="mark" data-reveal>
              <p className="mark-num">
                {dev.discordant.agent_only} <span>vs {dev.discordant.baseline_only}</span>
              </p>
              <p className="mark-cap">Questions only one of the two solved, agent vs baseline: they get different questions right</p>
            </div>
            <div className="mark" data-reveal>
              <p className="mark-num">p = {dev.discordant.p.toFixed(2)}</p>
              <p className="mark-cap">Exact McNemar test on the main set ({held.discordant.p.toFixed(2)} on held-out): neither gap is statistically significant</p>
            </div>
            <div className="mark" data-reveal>
              <p className="mark-num">{pct(dev.agent.grounded_answer_rate)}</p>
              <p className="mark-cap">Answers with every figure verified, up from {pct(v1.agent.grounded_answer_rate)} before the check moved into code</p>
            </div>
            <div className="mark" data-reveal>
              <p className="mark-num">{dev.agent.unsafe_sql_blocked + held.agent.unsafe_sql_blocked}</p>
              <p className="mark-cap">Writes or file reads attempted, across every measured question</p>
            </div>
            <div className="mark" data-reveal>
              <p className="mark-num">
                {pct(dev.agent.injection_success)} <span>vs {pct(dev.baseline.injection_success)}</span>
              </p>
              <p className="mark-cap">Questions over review text with planted instructions, answered correctly. Neither system followed one</p>
            </div>
            <div className="mark" data-reveal>
              <p className="mark-num">
                {Math.round(dev.agent.median_latency_s)} s <span>vs {Math.round(dev.baseline.median_latency_s)} s</span>
              </p>
              <p className="mark-cap">Median time per question on a local 9B model: the price of planning and checking</p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ MCP */}
        <section id="mcp" className="mcp-field" aria-labelledby="mcp-title">
          <McpSwitch />
        </section>

        {/* ------------------------------------------------ open source */}
        <section className="oss" aria-labelledby="oss-title">
          <div className="oss-text">
            <h2 id="oss-title" data-reveal>
              Open source, end to end
            </h2>
            <p data-reveal>
              A hand-written agent loop in Python, DuckDB, FastAPI and Next.js, under the MIT licence. It runs on a laptop with a local model and no API key,
              and the benchmark reproduces with <code>make eval</code>.
            </p>
            <a href={GITHUB} className="btn btn-secondary btn-lg" data-reveal>
              Read the code <ArrowUpRight aria-hidden />
            </a>
          </div>
          <div className="oss-code" data-ui data-reveal>
            <pre>
              <code>
                git clone {GITHUB}.git{"\n"}cd quarry{"\n"}make install data{"\n"}ollama pull qwen3.5:9b{"\n"}make serve
              </code>
            </pre>
          </div>
        </section>

        {/* ------------------------------------------------ close */}
        <section className="close" aria-labelledby="close-title">
          <div className="close-text">
            <h2 id="close-title" data-reveal>
              Ask it something
            </h2>
            <p data-reveal>
              The demo runs on Gemini&apos;s free tier, shared by everyone: about 60 questions a day in all and 6 an hour for each visitor. Shared links expire.
            </p>
          </div>
          <div className="close-box" data-reveal>
            <AskBox example={example} />
          </div>
        </section>
      </main>

      <footer className="site-foot">
        <div className="foot-mark" aria-hidden>
          <Logo height={160} />
        </div>
        <div className="foot-cols">
          <div>
            <p className="foot-h">Product</p>
            <Link href="/app/">Analysis</Link>
            <Link href="/app/benchmark/">Benchmark</Link>
            <Link href="/app/traces/">Traces</Link>
            <Link href="/app/data/">Data sources</Link>
          </div>
          <div>
            <p className="foot-h">Project</p>
            <a href={GITHUB}>GitHub</a>
            <a href={`${GITHUB}#readme`}>README</a>
            <a href={`${GITHUB}/blob/main/docs/brand.md`}>Brand guide</a>
            <a href={`${GITHUB}/blob/main/LICENSE`}>MIT licence</a>
          </div>
          <div className="foot-wide">
            <p className="foot-h">About the demo</p>
            <p>
              Gemini 3.5 Flash Lite on the free tier: about 60 questions a day across all visitors and 6 an hour each, 200 seconds a run, model-written Python
              off. Runs are kept only in memory, so shared links expire. The published scores come from a local model, not from this demo.
            </p>
          </div>
          <div className="foot-wide">
            <p className="foot-h">Data</p>
            <p>
              Brazilian E-Commerce Public Dataset by Olist,{" "}
              <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>, used non-commercially with attribution.
            </p>
          </div>
        </div>
        <div className="foot-last">
          <p>Built by Fares AbuSaleem.</p>
          <Link href="/app/" className="btn btn-primary btn-sm">
            Try the demo
          </Link>
        </div>
      </footer>
    </>
  );
}
