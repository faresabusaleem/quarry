// SQL syntax highlighting as React text nodes (never innerHTML). Usable on the server and
// in the browser.

import { Fragment } from "react";

const KEYWORDS = new Set(
  (
    "select from where group by order having limit offset join left right inner outer full cross on using as and or not " +
    "in is null case when then else end with distinct union all intersect except over partition qualify asc desc between " +
    "like ilike filter interval true false exists any some window rows range preceding following current row nulls first last"
  ).split(" "),
);

const TOKEN = /(--[^\n]*|'(?:[^']|'')*'|"(?:[^"]|"")*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w]*\b)/g;

export function highlightSql(code: string) {
  const parts = code.split(TOKEN);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("--")) return <span key={i} className="cm">{p}</span>;
    if (p.startsWith("'")) return <span key={i} className="str">{p}</span>;
    if (/^\d/.test(p)) return <span key={i} className="nm">{p}</span>;
    if (/^[A-Za-z_]/.test(p)) {
      if (KEYWORDS.has(p.toLowerCase())) return <span key={i} className="kw">{p}</span>;
      if (/^\s*\(/.test(parts[i + 1] ?? "")) return <span key={i} className="fn">{p}</span>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
