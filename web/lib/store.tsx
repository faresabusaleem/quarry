"use client";

// The app's conversation store. It lives in the /app layout, so a run keeps streaming while
// the visitor moves between Analysis, Traces, Benchmark and Data. Saved analyses stay in this
// browser (localStorage); the API contract is unchanged.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getJson, RateLimitError, streamChat, type AgentEvent } from "./api";
import { newId, parse, serialize, STORAGE_KEY, titleFrom, type Conversation } from "./conversations";
import { applyEvent, newTurn, type Turn } from "./run";

export interface Selection {
  turnKey: string;
  sourceId: string;
  citationId?: string;
}

interface Store {
  conversations: Conversation[];
  active: Conversation | null;
  busy: boolean;
  remaining: number | null;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  ask: (message: string) => void;
  stop: () => void;
  startNew: () => void;
  open: (id: string) => void;
  remove: (id: string) => void;
  replay: (runId: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside ConversationProvider");
  return s;
}

const REPLAY_PREFIX = "run:";

export function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [replayed, setReplayed] = useState<Conversation | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef(conversations);
  useEffect(() => {
    convRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    try {
      setConversations(parse(localStorage.getItem(STORAGE_KEY)));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serialize(conversations));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [conversations, loaded]);

  const patch = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const patchTurn = useCallback(
    (id: string, key: string, fn: (t: Turn) => Turn) =>
      patch(id, (c) => ({ ...c, updatedAt: Date.now(), turns: c.turns.map((t) => (t.key === key ? fn(t) : t)) })),
    [patch],
  );

  const ask = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busy) return;
      let conv = activeId ? convRef.current.find((c) => c.id === activeId) : undefined;
      const turn = newTurn(text);
      if (!conv) {
        const now = Date.now();
        conv = { id: newId(), title: titleFrom(text), createdAt: now, updatedAt: now, turns: [turn], sessionId: null, sessionState: null };
        const created = conv;
        setConversations((cs) => [created, ...cs]);
        setActiveId(created.id);
        setReplayed(null);
        window.history.replaceState(null, "", `/app/?c=${created.id}`);
      } else {
        patch(conv.id, (c) => ({ ...c, updatedAt: Date.now(), turns: [...c.turns, turn] }));
      }
      const id = conv.id;
      setBusy(true);
      setSelection(null);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await streamChat(
          { message: text, session_id: conv.sessionId, session: conv.sessionState ?? undefined },
          (name, data) => {
            if (name === "session_state") return patch(id, (c) => ({ ...c, sessionState: data }));
            if (name === "session") {
              if (typeof data.remaining_hour === "number") setRemaining(data.remaining_hour);
              return patch(id, (c) => ({ ...c, sessionId: data.session_id }));
            }
            patchTurn(id, turn.key, (t) => applyEvent(t, data as AgentEvent));
          },
          ctrl.signal,
        );
        patchTurn(id, turn.key, (t) =>
          t.status === "running"
            ? { ...t, status: "error", activity: "", error: t.error ?? { message: "The connection closed before the run finished." } }
            : t,
        );
      } catch (e) {
        if (e instanceof RateLimitError) {
          patchTurn(id, turn.key, (t) => ({ ...t, status: "rate_limited", activity: "", error: { message: e.reason, kind: e.reason, retryAfterS: e.retryAfterS } }));
        } else if ((e as Error).name === "AbortError") {
          patchTurn(id, turn.key, (t) => ({ ...t, status: "stopped", activity: "", waiting: undefined, error: { message: "You stopped this run.", kind: "stopped" } }));
        } else {
          const msg = (e as Error).message;
          const unreachable = e instanceof TypeError; // fetch itself failed: offline or server down
          patchTurn(id, turn.key, (t) => ({
            ...t,
            status: "error",
            activity: "",
            error: { message: unreachable ? `Could not reach the Quarry API (${msg}).` : msg, kind: unreachable ? "offline" : "setup" },
          }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [activeId, busy, patch, patchTurn],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const startNew = useCallback(() => {
    setActiveId(null);
    setReplayed(null);
    setSelection(null);
  }, []);

  const open = useCallback((id: string) => {
    setActiveId(id);
    setReplayed(null);
    setSelection(null);
  }, []);

  const remove = useCallback(
    (id: string) => {
      setConversations((cs) => cs.filter((c) => c.id !== id));
      if (activeId === id) startNew();
    },
    [activeId, startNew],
  );

  // /app/?run=<id> replays a saved trace. It is shown but not added to the history.
  const replay = useCallback((runId: string) => {
    const id = `${REPLAY_PREFIX}${runId}`;
    setActiveId(id);
    setSelection(null);
    const base = (turns: Turn[]): Conversation => ({
      id,
      title: turns[0]?.message ?? "Shared run",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns,
      sessionId: null,
      sessionState: null,
    });
    setReplayed(base([{ ...newTurn("Loading the shared run"), activity: "Loading" }]));
    getJson<{ events: AgentEvent[] }>(`/api/traces/${runId}`)
      .then((trace) => {
        const first = trace.events[0];
        let turn = newTurn(String(first?.data?.question ?? first?.data?.message ?? ""));
        for (const e of trace.events) turn = applyEvent(turn, e);
        setReplayed(base([turn]));
      })
      .catch(() =>
        setReplayed(
          base([
            {
              ...newTurn("Shared run"),
              status: "error",
              activity: "",
              error: { kind: "not_found", message: `Run ${runId} is not stored on this server.` },
            },
          ]),
        ),
      );
  }, []);

  const active = useMemo(() => {
    if (!activeId) return null;
    if (activeId.startsWith(REPLAY_PREFIX)) return replayed;
    return conversations.find((c) => c.id === activeId) ?? null;
  }, [activeId, conversations, replayed]);

  const value = useMemo<Store>(
    () => ({ conversations, active, busy, remaining, selection, setSelection, ask, stop, startNew, open, remove, replay }),
    [conversations, active, busy, remaining, selection, ask, stop, startNew, open, remove, replay],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
