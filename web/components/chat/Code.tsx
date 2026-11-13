"use client";

// SQL with syntax highlighting, built from text nodes (never innerHTML), plus a copy button.

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { highlightSql } from "@/lib/sql";

export { highlightSql };

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
