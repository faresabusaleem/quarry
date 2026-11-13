"use client";

// SQL with syntax highlighting, built from text nodes (never innerHTML), plus a copy button.

import { Check, Copy } from "lucide-react";
import { Fragment, useState } from "react";

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

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn sm copy"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
    </button>
  );
}

export function SqlBlock({ code, label = "SQL" }: { code: string; label?: string }) {
  const text = code.trim();
  return (
    <div className="code" role="group" aria-label={label}>
      <pre>
        <code>{highlightSql(text)}</code>
      </pre>
      <CopyButton text={text} label="Copy SQL" />
    </div>
  );
}

export function PlainBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="code" role="group" aria-label={label}>
      <pre>
        <code>{code.trim()}</code>
      </pre>
      <CopyButton text={code.trim()} />
    </div>
  );
}
