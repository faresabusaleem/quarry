// Turns a run's trace events into spans for the trace viewer's waterfall: each model call,
// tool call and wait, placed on one time axis that starts when the run started.

export interface TraceEvent {
  type: string;
  ts: number; // seconds since the epoch, when the event was emitted
  step: number | null;
  data: Record<string, any>;
}

export type SpanKind = "llm" | "tool" | "wait";

export interface Span {
  id: string;
  kind: SpanKind;
  label: string;
  detail: string;
  startMs: number;
  durationMs: number;
  ok: boolean;
  step: number | null;
  call?: TraceEvent; // tool_call
  result?: TraceEvent; // tool_result or llm_call
  reflection?: string; // what the agent concluded after a failure
}

function toolDetail(args: Record<string, any> = {}, tool: string): string {
  if (tool === "run_sql") return String(args.purpose ?? "").trim() || "query";
  if (tool === "describe_table" || tool === "sample_rows") return String(args.table ?? "");
  if (tool === "make_chart") return String(args.title ?? "");
  if (tool === "final_answer") return String(args.status ?? "answer");
  if (tool === "ask_user") return "clarifying question";
  return "";
}

export function buildSpans(events: TraceEvent[]): { spans: Span[]; totalMs: number } {
  if (!events.length) return { spans: [], totalMs: 0 };
  const t0 = events[0].ts;
  const ms = (ts: number) => (ts - t0) * 1000;
  const calls = new Map<string, TraceEvent>();
  const spans: Span[] = [];
  for (const e of events) {
    const d = e.data ?? {};
    if (e.type === "llm_call") {
      const dur = Number(d.latency_ms ?? 0);
      spans.push({
        id: `llm-${spans.length}`,
        kind: "llm",
        label: d.purpose === "plan" ? "Plan" : d.purpose === "act" ? "Model" : `Model: ${d.purpose ?? "call"}`,
        detail: `${d.input_tokens ?? 0} in · ${d.output_tokens ?? 0} out${d.thinking_tokens ? ` · ${d.thinking_tokens} thinking` : ""}`,
        startMs: Math.max(0, ms(e.ts) - dur),
        durationMs: dur,
        ok: true,
        step: e.step,
        result: e,
      });
    } else if (e.type === "tool_call") {
      calls.set(d.call_id, e);
    } else if (e.type === "tool_result") {
      const call = calls.get(d.call_id);
      const dur = Number(d.latency_ms ?? 0);
      spans.push({
        id: `tool-${d.call_id}`,
        kind: "tool",
        label: d.tool,
        detail: toolDetail(call?.data?.args, d.tool),
        startMs: Math.max(0, ms(e.ts) - dur),
        durationMs: dur,
        ok: !!d.ok,
        step: e.step,
        call,
        result: e,
      });
    } else if (e.type === "waiting") {
      spans.push({
        id: `wait-${spans.length}`,
        kind: "wait",
        label: d.reason === "rate_limited" ? "Rate limited" : d.reason === "pacing" ? "Pacing" : "Retry wait",
        detail: `${d.seconds} s`,
        startMs: ms(e.ts),
        durationMs: Number(d.seconds ?? 0) * 1000,
        ok: true,
        step: e.step,
      });
    } else if (e.type === "reflection") {
      const last = [...spans].reverse().find((s) => s.kind === "tool" && !s.ok && !s.reflection);
      if (last) last.reflection = `${d.kind}: ${d.message}`;
    }
  }
  const end = events[events.length - 1];
  const finished = events.find((e) => e.type === "run_finished");
  const totalMs = Math.max(
    Number(finished?.data?.latency_ms ?? 0),
    ms(end.ts),
    ...spans.map((s) => s.startMs + s.durationMs),
  );
  return { spans, totalMs };
}

/** "Nice" tick positions for a time axis of `totalMs`. */
export function ticks(totalMs: number, target = 5): number[] {
  if (totalMs <= 0) return [0];
  const raw = totalMs / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = 0; t <= totalMs + 1e-6; t += step) out.push(Math.round(t));
  return out;
}
