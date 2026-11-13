// A small Markdown subset (headings, paragraphs, nested lists, tables, code fences) parsed into
// plain blocks. Used for the hand-written error analysis and limitations; rendered as React
// nodes by components/Markdown.tsx, never as HTML.

export interface ListItem {
  text: string;
  children: ListBlock | null;
}
export interface ListBlock {
  type: "list";
  ordered: boolean;
  items: ListItem[];
}
export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | ListBlock
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; text: string };

const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      const body = rows.filter((r, j) => !(j === 1 && r.every((c) => /^:?-+:?$/.test(c))));
      blocks.push({ type: "table", header: body[0] ?? [], rows: body.slice(1) });
      continue;
    }
    if (LIST.test(line)) {
      // Collect the list's lines (items, nested items and indented continuations).
      const chunk: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          const next = lines.slice(i + 1).find((x) => x.trim());
          if (next && (LIST.test(next) || /^\s{2,}\S/.test(next))) {
            i++;
            continue;
          }
          break;
        }
        if (!LIST.test(l) && !/^\s+\S/.test(l) && chunk.length) break;
        chunk.push(l);
        i++;
      }
      blocks.push(parseList(chunk));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !lines[i].trim().startsWith("|")) {
      para.push(lines[i++].trim());
    }
    blocks.push({ type: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

function parseList(lines: string[]): ListBlock {
  const first = lines[0].match(LIST)!;
  const base = first[1].length;
  const list: ListBlock = { type: "list", ordered: /\d/.test(first[2]), items: [] };
  let nested: string[] = [];
  const flush = () => {
    const last = list.items[list.items.length - 1];
    if (last && nested.length) {
      // Nested items, plus continuation lines that follow them.
      const inner = nested.findIndex((l) => LIST.test(l));
      if (inner > 0) last.text += ` ${nested.slice(0, inner).map((l) => l.trim()).join(" ")}`;
      if (inner >= 0) last.children = parseList(nested.slice(inner));
      else last.text += ` ${nested.map((l) => l.trim()).join(" ")}`;
    }
    nested = [];
  };
  for (const l of lines) {
    const m = l.match(LIST);
    if (m && m[1].length <= base) {
      flush();
      list.items.push({ text: m[3].trim(), children: null });
    } else if (m || nested.length) {
      nested.push(l);
    } else {
      const last = list.items[list.items.length - 1];
      if (last) last.text += ` ${l.trim()}`;
    }
  }
  flush();
  return list;
}

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string };

/** Bold, inline code and links; everything else is literal text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "strong", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else out.push({ t: "link", v: m[3], href: m[4] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}
