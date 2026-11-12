// Folds the agent's event stream into the state one conversation turn renders from.

import type { AgentEvent, FinalData, SourceRecord } from "./api";

export type RunStatus =
  | "running"
  | "answered"
  | "refused"
  | "clarify"
  | "stopped"
  | "budget_exhausted"
  | "error"
  | "rate_limited";

export interface Step {
  callId: string;
  index: number;
  tool: string;
  args: Record<string, any>;
  status: "running" | "ok" | "error";
  content?: string;
  error?: string | null;
  data?: Record<string, any> | null;
  latencyMs?: number;
  reflection?: string;
  note?: string; // the model's own words just before this call
}

export interface Totals {
  status: string;
  steps: number;
  llm_calls: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
  recovered: boolean;
  queries: Record<string, SourceRecord>;
  python_runs: Record<string, SourceRecord>;
}

export interface Turn {
  key: string;
  message: string;
  runId?: string;
  status: RunStatus;
  plan?: string[];
  steps: Step[];
  activity: string;
  waiting?: { seconds: number; reason: string; until: number };
  final?: FinalData;
  clarification?: { question: string; options: string[]; reason: string };
  error?: { message: string; kind?: string; retryAfterS?: number };
  totals?: Totals;
  llmCalls: number;
  tokens: number;
  startedAt: number;
  pendingNote?: string;
}

const TOOL_ACTIVITY: Record<string, string> = {
  list_tables: "Listing tables",
  describe_table: "Reading table definitions",
  sample_rows: "Sampling rows",
  run_sql: "Running SQL",
  run_python: "Running analysis in the sandbox",
  make_chart: "Building a chart",
  ask_user: "Preparing a question",
  final_answer: "Checking the answer against the data",
};

export function newTurn(message: string): Turn {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    status: "running",
    steps: [],
    activity: "Planning",
    llmCalls: 0,
    tokens: 0,
    startedAt: Date.now(),
  };
}

export function applyEvent(turn: Turn, e: AgentEvent): Turn {
  const t: Turn = { ...turn, steps: turn.steps };
  const d = e.data ?? {};
  switch (e.type) {
    case "run_started":
      t.runId = e.run_id;
      break;
    case "plan":
      t.plan = d.steps;
      t.activity = "Thinking";
      break;
    case "llm_call":
      t.llmCalls += 1;
      t.tokens += (d.input_tokens ?? 0) + (d.output_tokens ?? 0) + (d.thinking_tokens ?? 0);
      t.waiting = undefined;
      t.activity = "Thinking";
      break;
    case "waiting":
      t.waiting = { seconds: d.seconds, reason: d.reason, until: Date.now() + d.seconds * 1000 };
      t.activity = d.reason === "rate_limited" ? "Waiting for model quota" : "Pacing requests";
      break;
    case "assistant_note":
      t.pendingNote = d.text;
      break;
    case "tool_call": {
      if (d.tool === "final_answer" || d.tool === "ask_user") {
        t.activity = TOOL_ACTIVITY[d.tool];
        break;
      }
      const step: Step = {
        callId: d.call_id,
        index: t.steps.length + 1,
        tool: d.tool,
        args: d.args ?? {},
        status: "running",
        note: t.pendingNote,
      };
      t.pendingNote = undefined;
      t.steps = [...t.steps, step];
      t.activity = TOOL_ACTIVITY[d.tool] ?? "Working";
      break;
    }
    case "tool_result": {
      if (d.tool === "final_answer" || d.tool === "ask_user") break;
      t.steps = t.steps.map((s) =>
        s.callId === d.call_id && s.status === "running"
          ? { ...s, status: d.ok ? "ok" : "error", content: d.content, error: d.error, data: d.data, latencyMs: d.latency_ms }
          : s,
      );
      break;
    }
    case "reflection": {
      if (d.kind === "tool_error" && t.steps.length) {
        const last = t.steps[t.steps.length - 1];
        t.steps = [...t.steps.slice(0, -1), { ...last, reflection: "The agent read this error and is retrying with a fix." }];
      }
      if (d.kind === "answer_rejected") t.activity = "Answer failed the grounding check, revising";
      if (d.kind === "budget") t.activity = "Step budget reached, wrapping up";
      break;
    }
    case "clarification":
      t.clarification = { question: d.question, options: d.options ?? [], reason: d.reason };
      break;
    case "final":
      t.final = d as FinalData;
      break;
    case "error":
      t.error = { message: d.message, kind: d.kind };
      break;
    case "run_finished":
      t.totals = d as Totals;
      t.status = (d.status as RunStatus) ?? "error";
      t.waiting = undefined;
      t.activity = "";
      break;
  }
  return t;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  return String(v);
}
