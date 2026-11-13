import { describe, expect, it } from "vitest";

import showcase from "../lib/generated/showcase-trace.json";
import { buildSpans, ticks, type TraceEvent } from "../lib/timeline";

const ev = (type: string, ts: number, data: Record<string, unknown>, step: number | null = null): TraceEvent => ({ type, ts, step, data });

describe("trace timeline", () => {
  it("places model calls, tool calls and waits on one axis", () => {
    const events = [
      ev("run_started", 100, {}),
      ev("llm_call", 101.5, { purpose: "plan", latency_ms: 1000, input_tokens: 10, output_tokens: 5 }),
      ev("tool_call", 101.6, { call_id: "c1", tool: "run_sql", args: { purpose: "count orders" } }, 1),
      ev("tool_result", 101.8, { call_id: "c1", tool: "run_sql", ok: false, latency_ms: 150 }, 1),
      ev("reflection", 101.8, { kind: "tool_error", message: "unknown column" }, 1),
      ev("waiting", 102, { reason: "rate_limited", seconds: 2 }),
      ev("run_finished", 104, { latency_ms: 4000 }),
    ];
    const { spans, totalMs } = buildSpans(events);
    expect(spans.map((s) => s.kind)).toEqual(["llm", "tool", "wait"]);
    expect(spans[0]).toMatchObject({ label: "Plan", startMs: 500, durationMs: 1000 });
    expect(spans[1]).toMatchObject({ label: "run_sql", detail: "count orders", ok: false, reflection: "tool_error: unknown column" });
    expect(Math.round(spans[1].startMs)).toBe(1650);
    expect(spans[2]).toMatchObject({ label: "Rate limited", startMs: 2000, durationMs: 2000 });
    expect(totalMs).toBe(4000);
  });

  it("reads the real showcase run", () => {
    const { spans, totalMs } = buildSpans((showcase as { events: TraceEvent[] }).events);
    expect(spans.filter((s) => s.kind === "tool").map((s) => s.label)).toEqual([
      "describe_table",
      "describe_table",
      "run_sql",
      "run_sql",
      "make_chart",
      "final_answer",
    ]);
    expect(spans.every((s) => s.startMs >= 0 && s.startMs + s.durationMs <= totalMs + 1)).toBe(true);
  });

  it("chooses round tick steps", () => {
    expect(ticks(17_833)).toEqual([0, 5000, 10000, 15000]);
    expect(ticks(900)).toEqual([0, 200, 400, 600, 800]);
  });
});
