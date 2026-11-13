"use client";

// The agent's plan and steps. While it runs, everything is visible and a live line says what
// it is doing; once an answer arrives the work folds into one line that can be reopened.

import { ChevronRight, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

import type { Turn } from "@/lib/run";
import { fixedSteps, workSummary } from "@/lib/summary";
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
  return <span className="mono">{left ?? "…"} s</span>;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  return <span className="mono">{now === null ? "0" : Math.max(0, Math.round((now - since) / 1000))} s</span>;
}

export function Work({ turn }: { turn: Turn }) {
  const running = turn.status === "running";
  const done = !running && (turn.final || turn.clarification);
  const [open, setOpen] = useState(false);
  const fixed = fixedSteps(turn.steps);
  const hasWork = !!turn.plan?.length || turn.steps.length > 0;
  if (!hasWork && !running) return null;

  const body = (
    <>
      {turn.plan && turn.plan.length > 0 && (
        <div className="plan">
          <p className="block-label">Plan</p>
          <ol>
            {turn.plan.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {turn.steps.length > 0 && (
        <ol className="steps" aria-label="Steps">
          {turn.steps.map((s) => (
            <StepCard key={s.callId} step={s} fixed={fixed.has(s.callId)} />
          ))}
        </ol>
      )}
    </>
  );

  if (done) {
    return (
      <section className={`work is-done ${open ? "is-open" : ""}`} aria-label="How Quarry worked this out">
        <button type="button" className="work-summary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronRight className="chev" aria-hidden />
          <span>{workSummary(turn)}</span>
          <span className="work-hint">{open ? "Hide work" : "Show work"}</span>
        </button>
        {open && <div className="work-body">{body}</div>}
      </section>
    );
  }

  return (
    <section className="work" aria-label="How Quarry is working this out">
      {body}
      {running && (
        <div className="activity" role="status" aria-live="polite">
          {turn.waiting ? <Clock3 aria-hidden /> : <span className="spinner" aria-hidden />}
          <span>
            {turn.activity || "Working"}
            {turn.waiting ? (
              <>
                {" "}
                · resuming in <Countdown until={turn.waiting.until} />
              </>
            ) : null}
          </span>
          <span className="activity-time">
            <Elapsed since={turn.startedAt} />
          </span>
        </div>
      )}
    </section>
  );
}
