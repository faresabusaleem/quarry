// A copy of each run's events kept in this browser tab, so the trace viewer still works on the
// hosted demo, where a run's server-side trace lives on one instance and the next request may
// reach another. The server's /api/traces stays the source of truth; this is the fallback.

import type { TraceEvent } from "./timeline";

const PREFIX = "quarry.trace.";
const INDEX = "quarry.trace.index";
const KEEP = 10;
const ROWS = 25;

export interface LocalTrace {
  summary: {
    run_id: string;
    created: number;
    question: string;
    message?: string;
    provider: string;
    model: string;
    status: string;
    steps: number | null;
    total_tokens: number | null;
    cost_usd: number | null;
    latency_ms: number | null;
  };
  events: TraceEvent[];
  local: true;
}

function capRows(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(capRows);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === "rows" && Array.isArray(v) ? v.slice(0, ROWS) : capRows(v);
    return out;
  }
  return value;
}

/** The summary the server would have written, rebuilt from the events themselves. */
export function summarize(events: TraceEvent[]): LocalTrace["summary"] | null {
  const start = events.find((e) => e.type === "run_started");
  if (!start) return null;
  const end = events.find((e) => e.type === "run_finished")?.data ?? {};
  const q = String(start.data.question ?? start.data.message ?? "");
  return {
    run_id: String((start as TraceEvent & { run_id?: string }).run_id ?? ""),
    created: start.ts,
    question: q,
    message: q,
    provider: String(start.data.provider ?? ""),
    model: String(start.data.model ?? ""),
    status: String(end.status ?? "error"),
    steps: end.steps ?? null,
    total_tokens: end.total_tokens ?? null,
    cost_usd: end.cost_usd ?? null,
    latency_ms: end.latency_ms ?? null,
  };
}

export function saveLocalTrace(runId: string, events: TraceEvent[]): void {
  try {
    sessionStorage.setItem(PREFIX + runId, JSON.stringify(capRows(events)));
    const index = (JSON.parse(sessionStorage.getItem(INDEX) ?? "[]") as string[]).filter((id) => id !== runId);
    index.push(runId);
    while (index.length > KEEP) sessionStorage.removeItem(PREFIX + index.shift());
    sessionStorage.setItem(INDEX, JSON.stringify(index));
  } catch {
    // Storage full or unavailable: the server copy is still the primary source.
  }
}

export function loadLocalTrace(runId: string): LocalTrace | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + runId);
    if (!raw) return null;
    const events = JSON.parse(raw) as TraceEvent[];
    const summary = summarize(events);
    return summary ? { summary, events, local: true } : null;
  } catch {
    return null;
  }
}
