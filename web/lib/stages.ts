// Splits one real run into the stages the landing page shows (plan, explore, query, chart,
// answer) with their true durations. Each model call belongs to the stage of the tool it chose
// next, so every second of the run lands in exactly one stage.

import { buildSpans, type TraceEvent } from "./timeline";

export type StageKey = "plan" | "explore" | "query" | "chart" | "answer";

const OF_TOOL: Record<string, StageKey> = {
  list_tables: "explore",
  describe_table: "explore",
  sample_rows: "explore",
  run_sql: "query",
  run_python: "query",
  make_chart: "chart",
  final_answer: "answer",
  ask_user: "answer",
};

export interface Stage {
  key: StageKey;
  ms: number;
  calls: number;
}

export function stagesFromTrace(events: TraceEvent[]): Stage[] {
  const { spans, totalMs } = buildSpans(events);
  const order: StageKey[] = ["plan", "explore", "query", "chart", "answer"];
  const end: Record<StageKey, number> = { plan: 0, explore: 0, query: 0, chart: 0, answer: 0 };
  const calls: Record<StageKey, number> = { plan: 0, explore: 0, query: 0, chart: 0, answer: 0 };
  let pending: number[] = [];
  for (const s of spans) {
    const stop = s.startMs + s.durationMs;
    if (s.kind === "llm" && s.result?.data?.purpose === "plan") {
      end.plan = Math.max(end.plan, stop);
      continue;
    }
    if (s.kind !== "tool") {
      pending.push(stop);
      continue;
    }
    const key = OF_TOOL[s.label] ?? "query";
    end[key] = Math.max(end[key], stop, ...pending);
    calls[key] += 1;
    pending = [];
  }
  end.answer = Math.max(end.answer, totalMs);
  // Durations are the time between one stage's last moment and the next stage's.
  let prev = 0;
  return order.map((key) => {
    const e = Math.max(end[key], prev);
    const st = { key, ms: e - prev, calls: calls[key] };
    prev = e;
    return st;
  });
}
