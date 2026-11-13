// Saved analyses: kept in this browser only (localStorage), grouped by date in the sidebar.
// Nothing here talks to the server; the conversation memory the API needs travels in
// `sessionState`, exactly as the chat request already sends it.

import type { Turn } from "./run";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  sessionId: string | null;
  sessionState: unknown;
}

export const STORAGE_KEY = "quarry.analyses.v1";
export const MAX_CONVERSATIONS = 30;
const MAX_BYTES = 3_500_000; // stay well inside the usual 5 MB localStorage quota
const SOURCE_ROWS = 25;
const STEP_ROWS = 8;

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A short sidebar title from the first question: whitespace collapsed, cut at a word. */
export function titleFrom(message: string, max = 60): string {
  const text = message.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text || "Untitled analysis";
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DateGroup {
  label: string;
  items: Conversation[];
}

/** Newest first, in the buckets people expect from chat apps. */
export function groupByDate(conversations: Conversation[], now = Date.now()): DateGroup[] {
  const today = startOfDay(now);
  const day = 86_400_000;
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const groups: DateGroup[] = [];
  const push = (label: string, c: Conversation) => {
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(c);
    else groups.push({ label, items: [c] });
  };
  for (const c of sorted) {
    const t = c.updatedAt;
    if (t >= today) push("Today", c);
    else if (t >= today - day) push("Yesterday", c);
    else if (t >= today - 7 * day) push("Previous 7 days", c);
    else if (t >= today - 30 * day) push("Previous 30 days", c);
    else push(new Date(t).toLocaleDateString("en-GB", { month: "long", year: "numeric" }), c);
  }
  return groups;
}

function capRows<T extends { rows?: unknown[] }>(x: T, n: number): T {
  return x.rows && x.rows.length > n ? { ...x, rows: x.rows.slice(0, n) } : x;
}

/** What is stored for a turn: result rows capped, and an unfinished run marked as such. */
export function compactTurn(turn: Turn): Turn {
  const t: Turn = { ...turn, waiting: undefined };
  if (t.status === "running") {
    t.status = "stopped";
    t.error = t.error ?? { message: "This run was interrupted before it finished." };
    t.activity = "";
  }
  t.steps = t.steps.map((s) => (s.data ? { ...s, data: capRows(s.data as { rows?: unknown[] }, STEP_ROWS) } : s));
  if (t.final) {
    const sources = Object.fromEntries(
      Object.entries(t.final.sources ?? {}).map(([k, v]) => [k, capRows(v, SOURCE_ROWS)]),
    );
    t.final = { ...t.final, sources };
  }
  if (t.totals) {
    t.totals = {
      ...t.totals,
      queries: Object.fromEntries(Object.entries(t.totals.queries ?? {}).map(([k, v]) => [k, capRows(v, SOURCE_ROWS)])),
      python_runs: Object.fromEntries(
        Object.entries(t.totals.python_runs ?? {}).map(([k, v]) => [k, capRows(v, SOURCE_ROWS)]),
      ),
    };
  }
  return t;
}

/** Serialise the newest analyses that fit the storage budget. */
export function serialize(conversations: Conversation[]): string {
  let list = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => ({ ...c, turns: c.turns.map(compactTurn) }));
  let json = JSON.stringify(list);
  while (json.length > MAX_BYTES && list.length > 1) {
    list = list.slice(0, -1);
    json = JSON.stringify(list);
  }
  return json;
}

export function parse(raw: string | null): Conversation[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (c): c is Conversation =>
        c && typeof c.id === "string" && typeof c.updatedAt === "number" && Array.isArray(c.turns),
    );
  } catch {
    return [];
  }
}
