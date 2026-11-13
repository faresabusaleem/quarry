// Checks the design tokens in app/tokens.css: every text/background pair the UI uses must
// pass WCAG AA in both themes, and the two copies of the dark theme must stay identical.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { contrast } from "../lib/color";

const css = readFileSync(join(__dirname, "..", "app", "tokens.css"), "utf8");

function block(selector: string, from = 0): string {
  const start = css.indexOf(selector, from);
  if (start < 0) throw new Error(`no block for ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = vars(block(":root {"));
const darkManual = vars(block(':root[data-theme="dark"]'));
const darkSystem = vars(block(':root:not([data-theme="light"])'));

function resolve(theme: Record<string, string>, name: string): string {
  let v = theme[name] ?? light[name];
  for (let i = 0; v && v.startsWith("var(") && i < 5; i++) {
    const ref = v.slice(6, -1);
    v = theme[ref] ?? light[ref];
  }
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`--${name} is not a hex colour: ${v}`);
  return v;
}

// [foreground, background, minimum ratio]: 4.5 for text, 3 for UI parts and chart marks.
const PAIRS: [string, string, number][] = [
  ...["bg", "surface", "fill"].flatMap((bg) => [
    ["text", bg, 4.5] as [string, string, number],
    ["text-2", bg, 4.5] as [string, string, number],
  ]),
  ["text-3", "bg", 4.5],
  ["text-3", "surface", 4.5],
  ["accent", "bg", 4.5],
  ["accent", "surface", 4.5],
  ["accent-strong", "fill", 4.5],
  ["accent-strong", "accent-subtle", 4.5],
  ["on-accent", "accent", 4.5],
  ["on-primary", "primary", 4.5],
  ["danger", "surface", 4.5],
  ["danger", "danger-subtle", 4.5],
  ["warn", "surface", 4.5],
  ["warn", "warn-subtle", 4.5],
  ...["code-text", "code-keyword", "code-string", "code-number", "code-comment"].map(
    (fg) => [fg, "code-bg", 4.5] as [string, string, number],
  ),
  ["focus", "bg", 3],
  ["focus", "surface", 3],
  ...[1, 2, 3, 4, 5, 6].map((i) => [`series-${i}`, "surface", 3] as [string, string, number]),
];

describe.each([
  ["light", light],
  ["dark", darkManual],
])("%s theme", (_name, theme) => {
  it.each(PAIRS)("--%s on --%s meets %s:1", (fg, bg, min) => {
    expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(min);
  });
});

describe("dark theme", () => {
  it("is defined identically for the system setting and the manual toggle", () => {
    expect(darkSystem).toEqual(darkManual);
  });

  it("uses graphite, not pure black and not blue-tinted", () => {
    for (const name of ["bg", "surface", "fill"]) {
      const hex = resolve(darkManual, name);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(r + g + b).toBeGreaterThan(30);
      expect(b - r).toBeLessThanOrEqual(3);
    }
  });
});
