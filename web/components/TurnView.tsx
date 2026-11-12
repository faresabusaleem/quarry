"use client";

import { useEffect, useState } from "react";

import type { Turn } from "@/lib/run";
import { formatMs, formatTokens } from "@/lib/run";
import { AnswerBlock, type Selection } from "./Answer";
import { IconAlert, IconClock, IconInfo } from "./icons";
import { StepCard } from "./StepCard";

function Countdown({ until }: { until: number }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [until]);
  return <span className="num">{left ?? "…"} s</span>;
}

function retryText(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const m = Math.ceil(seconds / 60);
  return m < 90 ? `${m} minutes` : `${Math.ceil(m / 60)} hours`;
}

export function TurnView({
  turn,
  isLast,
  busy,
  selection,
  onSelect,
  onReply,
  onRetry,
}: {
  turn: Turn;
  isLast: boolean;
  busy: boolean;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  onReply: (text: string) => void;
  onRetry: (text: string) => void;
}) {
  const running = turn.status === "running";
  const t = turn.totals;

  return (
    <article className="turn" aria-busy={running}>
      <header className="question">
        <span className="who">You</span>
        <h2>{turn.message}</h2>
      </header>

      {turn.plan && (
        <>
          <div className="block-label">Plan</div>
          <ol className="plan">
            {turn.plan.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}

      {(turn.steps.length > 0 || running) && (
        <>
          <div className="block-label">Work{turn.steps.length ? ` · ${turn.steps.length} ${turn.steps.length === 1 ? "step" : "steps"}` : ""}</div>
          {turn.steps.length > 0 && (
            <ol className="steps">
              {turn.steps.map((s) => (
                <StepCard key={s.callId} step={s} />
              ))}
            </ol>
          )}
          {running && (
            <div className={`running-line ${turn.steps.length ? "" : "solo"}`} role="status" aria-live="polite">
              {turn.waiting ? <IconClock /> : <span className="spinner" aria-hidden />}
              <span>
                {turn.activity || "Working"}
                {turn.waiting && (
                  <>
                    {" "}
                    · resuming in <Countdown until={turn.waiting.until} />
                  </>
                )}
              </span>
            </div>
          )}
        </>
      )}

      {turn.final && (
        <>
          <div className="block-label">Answer</div>
          <AnswerBlock final={turn.final} turnKey={turn.key} selection={selection} onSelect={onSelect} />
        </>
      )}

      {turn.clarification && (
        <>
          <div className="block-label">Quarry needs one detail</div>
          <div className="clarify" role="group" aria-label="Clarifying question">
            <p className="q">{turn.clarification.question}</p>
            {turn.clarification.reason && <p className="why">{turn.clarification.reason}</p>}
            <div className="chips">
              {turn.clarification.options.map((o) => (
                <button key={o} type="button" className="chip" disabled={!isLast || busy} onClick={() => onReply(o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {turn.status === "rate_limited" && turn.error && (
        <div className="notice warn" role="alert" style={{ marginTop: 12 }}>
          <IconClock />
          <div>
            <h3>{turn.error.kind === "busy" ? "Quarry is busy" : "Demo limit reached"}</h3>
            <p>
              {turn.error.kind === "busy"
                ? "Two questions are already running on this free demo. "
                : turn.error.kind === "daily_limit"
                  ? "The demo's daily question budget is used up, which keeps the free model quota from running out. "
                  : "This demo allows a limited number of questions per hour so the free model quota lasts. "}
              Try again in {retryText(turn.error.retryAfterS ?? 60)}.
            </p>
          </div>
        </div>
      )}

      {turn.error && turn.status !== "rate_limited" && !turn.final && !turn.clarification && (
        <div className="notice error" role="alert" style={{ marginTop: 12 }}>
          <IconAlert />
          <div>
            <h3>
              {turn.error.kind === "repeat_failure"
                ? "Stopped after the same error twice"
                : turn.error.kind === "budget"
                  ? "Ran out of steps"
                  : turn.error.kind === "RateLimitError"
                    ? "The model provider is rate limiting requests"
                    : "This run did not finish"}
            </h3>
            <p>{turn.error.message}</p>
            {isLast && (
              <p style={{ marginTop: 8 }}>
                <button type="button" className="btn secondary" disabled={busy} onClick={() => onRetry(turn.message)}>
                  Try again
                </button>
              </p>
            )}
          </div>
        </div>
      )}

      {t && (
        <p className="run-meta">
          <span className="num">{t.steps} {t.steps === 1 ? "step" : "steps"}</span>
          <span className="num">{t.llm_calls} model calls</span>
          <span className="num">{formatTokens(t.total_tokens)} tokens</span>
          <span className="num">{formatMs(t.latency_ms)}</span>
          {turn.provider === "ollama" ? (
            <span>local model, no API cost</span>
          ) : (
            <span className="num" title="What this run would cost on the provider's paid tier. The demo runs on a free tier.">
              ${t.cost_usd.toFixed(4)} at paid rates
            </span>
          )}
          {t.recovered && (
            <span>
              <IconInfo width={12} height={12} style={{ verticalAlign: -1 }} /> recovered from an error
            </span>
          )}
          {turn.runId && <a href={`/traces/?id=${turn.runId}`}>Trace</a>}
          {turn.runId && <a href={`/?run=${turn.runId}`}>Permalink</a>}
        </p>
      )}
    </article>
  );
}
