// Small, testable text helpers for a finished turn.

import type { FinalData } from "./api";
import type { Step, Turn } from "./run";

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ids of steps that succeeded right after a failed attempt with the same tool. */
export function fixedSteps(steps: Step[]): Set<string> {
  const fixed = new Set<string>();
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    if (prev.status === "error" && steps[i].status === "ok" && steps[i].tool === prev.tool) {
      fixed.add(steps[i].callId);
    }
  }
  return fixed;
}

/** The one line a finished run collapses to: "6 steps · recovered from 1 error · 28 s". */
export function workSummary(turn: Turn, now = Date.now()): string {
  const parts = [turn.steps.length ? plural(turn.steps.length, "step") : "No queries run"];
  const errors = turn.steps.filter((s) => s.status === "error").length;
  if (errors) {
    const recovered = turn.totals?.recovered ?? (turn.status === "answered" || fixedSteps(turn.steps).size > 0);
    parts.push(recovered ? `recovered from ${plural(errors, "error")}` : plural(errors, "error"));
  }
  parts.push(duration(turn.totals?.latency_ms ?? now - turn.startedAt));
  return parts.join(" · ");
}

/** The answer as plain text for the clipboard: citation markers become their numbers. */
export function plainAnswer(final: FinalData): string {
  const cites = new Map(final.citations.map((c) => [c.id, c.text]));
  return final.answer
    .replace(/\[([na]\d+)\]/g, (m, id: string) => cites.get(id) ?? m)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
