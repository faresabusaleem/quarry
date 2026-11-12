"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Selection } from "@/components/Answer";
import { IconArrow, IconSend } from "@/components/icons";
import { DatasetPanel, SourceInspector } from "@/components/Inspector";
import { TurnView } from "@/components/TurnView";
import { getJson, RateLimitError, streamChat, type AgentEvent, type SchemaInfo, type SourceRecord } from "@/lib/api";
import { applyEvent, newTurn, type Turn } from "@/lib/run";

const FALLBACK_EXAMPLES = [
  "Which product categories grew fastest last quarter, and why?",
  "What was revenue in each month from January to August 2018?",
  "Which 5 customer states have the highest share of late deliveries?",
  "How does the average review score differ for late and on-time deliveries?",
  "Who are our best customers?",
];

export default function AskPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // The conversation memory travels with the client so follow-ups work on any server instance.
  const [sessionState, setSessionState] = useState<unknown>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getJson<SchemaInfo>("/api/schema").then(setSchema).catch(() => setSchema(null));
  }, []);

  // /?run=<id> replays a saved run from its trace, so any analysis can be shared by link.
  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get("run");
    if (!runId || !/^[a-z0-9]+$/i.test(runId)) return;
    getJson<{ events: AgentEvent[] }>(`/api/traces/${runId}`)
      .then((trace) => {
        const first = trace.events[0];
        let turn = newTurn(String(first?.data?.message ?? first?.data?.question ?? ""));
        for (const e of trace.events) turn = applyEvent(turn, e);
        setTurns([turn]);
      })
      .catch(() => setTurns([{ ...newTurn("Saved run"), status: "error", error: { message: `Run ${runId} was not found.` } }]));
  }, []);

  const lastSteps = turns[turns.length - 1]?.steps.length;
  const lastStatus = turns[turns.length - 1]?.status;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, lastSteps, lastStatus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = (key: string, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.key === key ? fn(t) : t)));

  const ask = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busy) return;
      const turn = newTurn(text);
      setTurns((ts) => [...ts, turn]);
      setInput("");
      setBusy(true);
      setSelection(null);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await streamChat(
          { message: text, session_id: sessionId, session: sessionState ?? undefined },
          (name, data) => {
            if (name === "session_state") {
              setSessionState(data);
              return;
            }
            if (name === "session") {
              setSessionId(data.session_id);
              if (typeof data.remaining_hour === "number") setRemaining(data.remaining_hour);
              return;
            }
            update(turn.key, (t) => applyEvent(t, data));
          },
          ctrl.signal,
        );
        update(turn.key, (t) => (t.status === "running" ? { ...t, status: "error", error: t.error ?? { message: "The connection closed before the run finished." } } : t));
      } catch (e) {
        if (e instanceof RateLimitError) {
          update(turn.key, (t) => ({ ...t, status: "rate_limited", error: { message: e.reason, kind: e.reason, retryAfterS: e.retryAfterS } }));
        } else if ((e as Error).name === "AbortError") {
          update(turn.key, (t) => ({ ...t, status: "stopped", error: { message: "You stopped this run." } }));
        } else {
          const msg = (e as Error).message;
          const unreachable = e instanceof TypeError; // fetch() itself failed: network or server down
          update(turn.key, (t) => ({ ...t, status: "error", error: { message: unreachable ? `Could not reach the Quarry API (${msg}).` : msg, kind: "setup" } }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [busy, sessionId, sessionState],
  );

  const sourceFor = (sel: Selection): SourceRecord | undefined => {
    const t = turns.find((x) => x.key === sel.turnKey);
    return t?.final?.sources?.[sel.sourceId] ?? t?.totals?.queries?.[sel.sourceId] ?? t?.totals?.python_runs?.[sel.sourceId];
  };

  const newConversation = () => {
    abortRef.current?.abort();
    setTurns([]);
    setSessionId(null);
    setSessionState(null);
    setSelection(null);
  };

  const examples = schema?.examples ?? FALLBACK_EXAMPLES;
  const lastTurn = turns[turns.length - 1];
  const awaitingReply = lastTurn?.status === "clarify";

  return (
    <div className="ask">
      <div className="thread-col">
        <div className="thread">
          {turns.length === 0 ? (
            <section className="empty" aria-labelledby="empty-title">
              <h1 id="empty-title">Ask the Olist marketplace a question</h1>
              <p className="lead">
                Quarry plans the analysis, explores the tables, writes and checks its own SQL, and links every number in
                the answer to the query that produced it.
              </p>
              <ul className="facts" aria-label="Dataset facts">
                <li>
                  <b className="num">99,441</b>
                  <span>real orders</span>
                </li>
                <li>
                  <b>Sep 2016 – Oct 2018</b>
                  <span>purchase dates</span>
                </li>
                <li>
                  <b className="num">9</b>
                  <span>related tables</span>
                </li>
                <li>
                  <b>Read-only</b>
                  <span>enforced by the engine</span>
                </li>
              </ul>
              <p className="examples-label" id="examples-label">
                Try one of these
              </p>
              <ul className="examples" aria-labelledby="examples-label">
                {examples.map((q) => (
                  <li key={q}>
                    <button type="button" onClick={() => ask(q)} disabled={busy}>
                      <span>{q}</span>
                      <IconArrow />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            turns.map((t, i) => (
              <TurnView
                key={t.key}
                turn={t}
                isLast={i === turns.length - 1}
                busy={busy}
                selection={selection}
                onSelect={setSelection}
                onReply={ask}
                onRetry={ask}
              />
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="composer-wrap">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <label htmlFor="q" className="visually-hidden">
              Your question
            </label>
            <textarea
              id="q"
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={1000}
              placeholder={awaitingReply ? "Pick an option above or type your answer" : turns.length ? "Ask a follow-up" : "Ask about revenue, orders, categories, sellers, deliveries or reviews"}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(input);
                }
              }}
            />
            {busy ? (
              <button type="button" className="btn secondary" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn" disabled={!input.trim()} aria-label="Send question">
                <IconSend /> Ask
              </button>
            )}
          </form>
          <div className="composer-hint">
            <span>Enter to send · Shift+Enter for a new line</span>
            <span>
              {remaining !== null && <span className="num">{remaining} questions left this hour · </span>}
              {turns.length > 0 && (
                <button type="button" className="link-btn" onClick={newConversation}>
                  New conversation
                </button>
              )}
            </span>
          </div>
        </div>
      </div>

      {selection && <div className="scrim" onClick={() => setSelection(null)} aria-hidden />}
      <aside className={`rail ${selection ? "open" : ""}`} aria-label={selection ? "Source inspector" : "Dataset"}>
        {selection ? (
          <SourceInspector selection={selection} source={sourceFor(selection)} onClose={() => setSelection(null)} />
        ) : (
          <DatasetPanel schema={schema} />
        )}
      </aside>
    </div>
  );
}
