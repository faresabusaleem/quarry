"use client";

import { Activity, Ban, CircleAlert, Clock3, Copy, Link2, RotateCcw, Unplug } from "lucide-react";

import { FacetIcon } from "@/components/brand/Logo";
import type { Citation } from "@/lib/api";
import type { Turn } from "@/lib/run";
import { formatTokens } from "@/lib/run";
import type { Selection } from "@/lib/store";
import { duration, plainAnswer } from "@/lib/summary";
import { Answer, AnswerText } from "./Answer";
import { Work } from "./Work";

function retryIn(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const m = Math.ceil(seconds / 60);
  return m < 90 ? `${m} minutes` : `${Math.ceil(m / 60)} hours`;
}

function ErrorState({ turn, canRetry, busy, onRetry }: { turn: Turn; canRetry: boolean; busy: boolean; onRetry: () => void }) {
  const e = turn.error!;
  const kind = e.kind ?? "";
  const retry = canRetry && kind !== "not_found" && (
    <div className="notice-actions">
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onRetry}>
        <RotateCcw aria-hidden /> Ask again
      </button>
    </div>
  );

  if (turn.status === "rate_limited") {
    const busyNow = kind === "busy";
    return (
      <div className="notice warn" role="alert">
        <Clock3 aria-hidden />
        <div>
          <h3>{busyNow ? "Quarry is busy right now" : kind === "daily_limit" ? "Today's demo questions are used up" : "Hourly demo limit reached"}</h3>
          <p>
            {busyNow
              ? "Two questions are already running on this free demo. "
              : kind === "daily_limit"
                ? "The demo runs on a free model quota shared by every visitor, so it answers a limited number of questions a day. "
                : "Each visitor can ask a few questions an hour, so the free model quota lasts for everyone. "}
            Try again in {retryIn(e.retryAfterS ?? 60)}.
          </p>
        </div>
      </div>
    );
  }
  if (kind === "stopped") {
    return (
      <div className="notice" role="status">
        <Ban aria-hidden />
        <div>
          <h3>Stopped</h3>
          <p>You stopped this run. The steps above show how far it got.</p>
          {retry}
        </div>
      </div>
    );
  }
  if (kind === "not_found") {
    return (
      <div className="notice" role="alert">
        <Link2 aria-hidden />
        <div>
          <h3>This shared link has expired</h3>
          <p>
            {e.message} The hosted demo keeps runs only while its server instance is running, so shared links expire. Ask the
            question again to see a fresh run.
          </p>
        </div>
      </div>
    );
  }
  const title =
    kind === "repeat_failure"
      ? "Stopped after the same error twice"
      : kind === "budget"
        ? "Ran out of steps"
        : kind === "offline"
          ? "Quarry's server cannot be reached"
          : kind === "RateLimitError"
            ? "The model provider is limiting requests"
            : "This run did not finish";
  return (
    <div className="notice danger" role="alert">
      {kind === "offline" ? <Unplug aria-hidden /> : <CircleAlert aria-hidden />}
      <div>
        <h3>{title}</h3>
        <p>{e.message}</p>
        {retry}
      </div>
    </div>
  );
}

export function TurnView({
  turn,
  isLast,
  busy,
  selection,
  onSelect,
  onReply,
  onCopied,
  onShare,
}: {
  turn: Turn;
  isLast: boolean;
  busy: boolean;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  onReply: (text: string) => void;
  onCopied: () => void;
  onShare: (runId: string) => void;
}) {
  const t = turn.totals;
  const final = turn.final;
  const answered = final?.status === "answered";
  const activeCitation = selection?.turnKey === turn.key ? selection.citationId : undefined;
  const cite = (c: Citation) => onSelect({ turnKey: turn.key, sourceId: c.source_id, citationId: c.id });

  return (
    <article className="turn" aria-busy={turn.status === "running"}>
      <div className="question">
        <p>{turn.message}</p>
      </div>

      <div className="reply">
        <div className="reply-avatar" aria-hidden>
          <FacetIcon size={20} />
        </div>
        <div className="reply-body">
          <Work turn={turn} />

          {final && answered && (
            <Answer
              final={final}
              activeCitation={activeCitation}
              onCite={cite}
              onShowSource={(sourceId) => onSelect({ turnKey: turn.key, sourceId })}
            />
          )}

          {final && final.status === "refused" && (
            <div className="notice" role="status">
              <Ban aria-hidden />
              <div>
                <h3>Outside what Quarry will do</h3>
                <AnswerText text={final.answer} citations={[]} onCite={() => {}} />
              </div>
            </div>
          )}

          {turn.clarification && (
            <div className="clarify" role="group" aria-label="Quarry needs one detail">
              <p className="clarify-q">{turn.clarification.question}</p>
              {turn.clarification.reason && <p className="clarify-why">{turn.clarification.reason}</p>}
              <div className="clarify-options">
                {turn.clarification.options.map((o) => (
                  <button key={o} type="button" className="reply-chip" disabled={!isLast || busy} onClick={() => onReply(o)}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turn.error && !final && !turn.clarification && (
            <ErrorState turn={turn} canRetry={isLast} busy={busy} onRetry={() => onReply(turn.message)} />
          )}

          {t && (final || turn.clarification) && (
            <footer className="turn-foot">
              <div className="turn-actions">
                {answered && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigator.clipboard?.writeText(plainAnswer(final)).then(onCopied)}
                  >
                    <Copy aria-hidden /> Copy
                  </button>
                )}
                {turn.runId && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShare(turn.runId!)}>
                    <Link2 aria-hidden /> Share
                  </button>
                )}
                {turn.runId && (
                  <a className="btn btn-ghost btn-sm" href={`/app/traces/?id=${turn.runId}`}>
                    <Activity aria-hidden /> Trace
                  </a>
                )}
              </div>
              <p className="turn-meta mono">
                {duration(t.latency_ms)} · {t.llm_calls} model {t.llm_calls === 1 ? "call" : "calls"} · {formatTokens(t.total_tokens)} tokens
                {turn.provider === "ollama" ? " · local model" : t.cost_usd ? ` · $${t.cost_usd.toFixed(4)} at paid rates` : ""}
              </p>
            </footer>
          )}
        </div>
      </div>
    </article>
  );
}
