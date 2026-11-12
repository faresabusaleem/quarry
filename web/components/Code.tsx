// SQL display with light keyword highlighting, built from text nodes (never innerHTML).

import { Fragment } from "react";

const KEYWORDS = new Set(
  (
    "select from where group by order having limit join left right inner outer full on using as and or not in is null " +
    "case when then else end with distinct union all intersect except over partition qualify asc desc between like " +
    "count sum avg min max cast extract date_trunc strftime filter interval true false"
  ).split(" "),
);

export function Sql({ code }: { code: string }) {
  const parts = code.split(/('(?:[^']|'')*'|--[^\n]*|\b\w+\b)/g);
  return (
    <pre className="sql">
      <code>
        {parts.map((p, i) => {
          if (!p) return null;
          if (p.startsWith("'")) return <span key={i} className="str">{p}</span>;
          if (p.startsWith("--")) return <span key={i} className="cm">{p}</span>;
          if (KEYWORDS.has(p.toLowerCase())) return <span key={i} className="kw">{p}</span>;
          return <Fragment key={i}>{p}</Fragment>;
        })}
      </code>
    </pre>
  );
}

export function Python({ code }: { code: string }) {
  return (
    <pre className="sql">
      <code>{code}</code>
    </pre>
  );
}
