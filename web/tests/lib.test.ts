import { describe, expect, it } from "vitest";

import { compactTurn, groupByDate, parse, serialize, titleFrom, type Conversation } from "../lib/conversations";
import { parseInline, parseMarkdown } from "../lib/markdown";
import { newTurn, type Step, type Turn } from "../lib/run";
import { duration, fixedSteps, plainAnswer, workSummary } from "../lib/summary";

const conv = (id: string, updatedAt: number, turns: Turn[] = []): Conversation => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  turns,
  sessionId: null,
  sessionState: null,
});

const step = (callId: string, tool: string, status: Step["status"]): Step => ({ callId, index: 1, tool, args: {}, status });

describe("conversations", () => {
  it("titles a question at a word boundary", () => {
    expect(titleFrom("  How   many orders?  ")).toBe("How many orders?");
    const t = titleFrom("Which product categories grew fastest last quarter compared with the one before it, and why?");
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t).not.toMatch(/\s…$/);
  });

  it("groups newest first into date buckets", () => {
    const now = new Date(2026, 10, 13, 15, 0).getTime();
    const day = 86_400_000;
    const groups = groupByDate(
      [conv("old", now - 90 * day), conv("today", now - 3_600_000), conv("week", now - 3 * day), conv("yday", now - day), conv("month", now - 20 * day)],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "August 2026"]);
    expect(groups[0].items[0].id).toBe("today");
  });

  it("stores an interrupted run as stopped and caps result rows", () => {
    const t = newTurn("q");
    t.steps = [{ ...step("a", "run_sql", "ok"), data: { rows: Array.from({ length: 100 }, (_, i) => [i]) } }];
    const c = compactTurn(t);
    expect(c.status).toBe("stopped");
    expect((c.steps[0].data as { rows: unknown[] }).rows).toHaveLength(8);
  });

  it("round-trips through storage and ignores junk", () => {
    const list = [conv("a", 2), conv("b", 1)];
    expect(parse(serialize(list)).map((c) => c.id)).toEqual(["a", "b"]);
    expect(parse("not json")).toEqual([]);
    expect(parse('[{"id": 1}]')).toEqual([]);
  });
});

describe("summary", () => {
  it("formats durations", () => {
    expect(duration(28_400)).toBe("28 s");
    expect(duration(64_000)).toBe("1 min 4 s");
    expect(duration(120_000)).toBe("2 min");
  });

  it("marks a retry that succeeded as fixed", () => {
    const steps = [step("1", "run_sql", "error"), step("2", "run_sql", "ok"), step("3", "make_chart", "ok")];
    expect([...fixedSteps(steps)]).toEqual(["2"]);
  });

  it("collapses a run into one line", () => {
    const t = newTurn("q");
    t.steps = [step("1", "describe_table", "ok"), step("2", "run_sql", "error"), step("3", "run_sql", "ok")];
    t.status = "answered";
    t.totals = { latency_ms: 28_300, recovered: true } as Turn["totals"];
    expect(workSummary(t)).toBe("3 steps · recovered from 1 error · 28 s");
    t.steps = [step("1", "run_sql", "ok")];
    expect(workSummary(t)).toBe("1 step · 28 s");
  });

  it("copies an answer with its numbers in place of the markers", () => {
    const final = {
      answer: "Revenue was **[n1]** in `2018` ([n2]).",
      citations: [
        { id: "n1", text: "R$ 7.3M", value: 7.3e6, source_id: "q1" },
        { id: "n2", text: "up 20%", value: 0.2, source_id: "q2" },
      ],
    } as Parameters<typeof plainAnswer>[0];
    expect(plainAnswer(final)).toBe("Revenue was R$ 7.3M in 2018 (up 20%).");
  });
});

describe("markdown", () => {
  it("parses headings, nested lists with continuations, and tables", () => {
    const md = [
      "### Causes",
      "",
      "1. **Too many rows (8 items).**",
      "   The agent queries the top 5.",
      "2. **Tooling (2 items).**",
      "   - **A03:** it used `or` as an alias.",
      "     The model resent it.",
      "   - **M05:** stopped.",
      "",
      "| Run | Agent |",
      "|---|---|",
      "| v3 | 65 |",
    ].join("\n");
    const blocks = parseMarkdown(md);
    expect(blocks[0]).toEqual({ type: "heading", level: 3, text: "Causes" });
    const list = blocks[1];
    if (list.type !== "list") throw new Error("expected a list");
    expect(list.ordered).toBe(true);
    expect(list.items[0].text).toBe("**Too many rows (8 items).** The agent queries the top 5.");
    expect(list.items[1].children?.items.map((i) => i.text)).toEqual([
      "**A03:** it used `or` as an alias. The model resent it.",
      "**M05:** stopped.",
    ]);
    expect(blocks[2]).toEqual({ type: "table", header: ["Run", "Agent"], rows: [["v3", "65"]] });
  });

  it("parses inline bold, code and links", () => {
    expect(parseInline("See **this** and `q1` in [docs](https://x.y).")).toEqual([
      { t: "text", v: "See " },
      { t: "strong", v: "this" },
      { t: "text", v: " and " },
      { t: "code", v: "q1" },
      { t: "text", v: " in " },
      { t: "link", v: "docs", href: "https://x.y" },
      { t: "text", v: "." },
    ]);
  });
});
