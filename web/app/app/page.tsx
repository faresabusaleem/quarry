"use client";

import { ArrowRight, Check } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { Inspector } from "@/components/chat/Inspector";
import { TurnView } from "@/components/chat/TurnView";
import results from "@/lib/generated/results.json";
import { useStore } from "@/lib/store";

const EXAMPLES: { id: string; question: string }[] = results.examples;

function Toast({ text }: { text: string }) {
  return (
    <div className="toast" role="status">
      <Check aria-hidden /> {text}
    </div>
  );
}

function Chat() {
  const { active, busy, remaining, selection, setSelection, ask, stop, open, replay, startNew } = useStore();
  const params = useSearchParams();
  const composer = useRef<ComposerHandle>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ?c=<id> opens a saved analysis; ?run=<id> replays a shared run.
  const c = params.get("c");
  const run = params.get("run");
  useEffect(() => {
    if (run && /^[a-z0-9]+$/i.test(run)) replay(run);
    else if (c) open(c);
    else startNew();
  }, [c, run, open, replay, startNew]);

  const turns = active?.turns ?? [];
  const last = turns[turns.length - 1];
  const lastSteps = last?.steps.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, lastSteps, last?.status]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const sel = selection && turns.find((t) => t.key === selection.turnKey);
  const source = sel ? (sel.final?.sources?.[selection!.sourceId] ?? sel.totals?.queries?.[selection!.sourceId] ?? sel.totals?.python_runs?.[selection!.sourceId]) : undefined;
  const citation = sel?.final?.citations.find((x) => x.id === selection?.citationId);

  const share = (runId: string) => {
    const url = `${window.location.origin}/app/?run=${runId}`;
    navigator.clipboard?.writeText(url).then(() => setToast("Link copied. On the hosted demo, shared links expire when the server restarts."));
  };

  const submit = (text: string) => ask(text);
  const placeholder = last?.status === "clarify" ? "Pick an option above, or type your answer" : turns.length ? "Ask a follow-up" : "Ask a question about orders, revenue, deliveries, sellers or reviews";

  if (!turns.length) {
    return (
      <div className="chat chat-empty">
        <section className="empty" aria-labelledby="empty-title">
          <h1 id="empty-title">What do you want to know about your data?</h1>
          <p className="empty-sub">
            Quarry plans the analysis, writes and checks its own SQL on 99,441 real marketplace orders, and links every number in the answer to the query
            behind it.
          </p>
          <Composer ref={composer} busy={busy} placeholder={placeholder} remaining={remaining} onSubmit={submit} onStop={stop} autoFocus />
          <div className="suggestions" aria-labelledby="suggestions-label">
            <p id="suggestions-label" className="eyebrow">
              From the benchmark
            </p>
            <ul>
              {EXAMPLES.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => submit(e.question)} disabled={busy}>
                    <span>{e.question}</span>
                    <ArrowRight aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
        {toast && <Toast text={toast} />}
      </div>
    );
  }

  return (
    <div className={`chat ${selection ? "has-inspector" : ""}`}>
      <div className="thread-scroll">
        <div className="thread">
          {turns.map((t, i) => (
            <TurnView
              key={t.key}
              turn={t}
              isLast={i === turns.length - 1}
              busy={busy}
              selection={selection}
              onSelect={setSelection}
              onReply={submit}
              onCopied={() => setToast("Answer copied")}
              onShare={share}
            />
          ))}
          <div ref={endRef} className="thread-end" />
        </div>
      </div>
      <div className="composer-dock">
        <Composer ref={composer} busy={busy} placeholder={placeholder} remaining={remaining} onSubmit={submit} onStop={stop} />
        <p className="composer-note">Quarry can be wrong. Every number links to the query that produced it, so you can check.</p>
      </div>
      {selection && (
        <>
          <div className="inspector-scrim" onClick={() => setSelection(null)} aria-hidden />
          <Inspector sourceId={selection.sourceId} source={source} citation={citation} onClose={() => setSelection(null)} />
        </>
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}

export default function AppPage() {
  return (
    <Suspense fallback={null}>
      <Chat />
    </Suspense>
  );
}
