"use client";

// The final answer. Its text comes from a model that has read customer-written data, so it is
// never injected as HTML: a small Markdown subset becomes React nodes and every [nX] marker
// becomes a button that opens the query and result behind the number.

import { CircleAlert, Info } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Citation, FinalData } from "@/lib/api";
import { ResultTable } from "./ResultTable";
import { VegaChart } from "./VegaChart";

function inline(text: string, cites: Map<string, Citation>, onCite: (c: Citation) => void, active?: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[na]\d+\])/g).map((part, i) => {
    if (!part) return null;
    const m = part.match(/^\[([na]\d+)\]$/);
    if (m) {
      const c = cites.get(m[1]);
      if (!c) return <span key={i}>{part}</span>;
      return (
        <button
          key={i}
          type="button"
          className="cite"
          aria-pressed={active === c.id}
          aria-label={`${c.text}, from result ${c.source_id}. Show the query and result.`}
          onClick={() => onCite(c)}
        >
          <span className="cite-value">{c.text}</span>
          <span className="cite-src">{c.source_id}</span>
        </button>
      );
    }
    if (part.startsWith("**")) return <strong key={i}>{inline(part.slice(2, -2), cites, onCite, active)}</strong>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

export function AnswerText({
  text,
  citations,
  onCite,
  active,
}: {
  text: string;
  citations: Citation[];
  onCite: (c: Citation) => void;
  active?: string;
}) {
  const cites = new Map(citations.map((c) => [c.id, c]));
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className="answer-text">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const bullet = /^\s*([-*]|\d+\.)\s+/;
        if (lines.length > 0 && lines.every((l) => bullet.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(bullet, ""), cites, onCite, active)}</li>);
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return <p key={i}>{inline(lines.join(" "), cites, onCite, active)}</p>;
      })}
    </div>
  );
}

export function Answer({
  final,
  activeCitation,
  onCite,
  onShowSource,
}: {
  final: FinalData;
  activeCitation?: string;
  onCite: (c: Citation) => void;
  onShowSource: (sourceId: string) => void;
}) {
  const [showData, setShowData] = useState<Record<string, boolean>>({});

  return (
    <div className="answer">
      <AnswerText text={final.answer} citations={final.citations} active={activeCitation} onCite={onCite} />

      {final.unverified?.length > 0 && (
        <div className="notice warn answer-note" role="note">
          <CircleAlert aria-hidden />
          <div>
            <h3>Some figures could not be checked</h3>
            <p>
              {final.unverified.length === 1 ? "One number" : `${final.unverified.length} numbers`} in this answer did not match
              any query result: <span className="mono">{final.unverified.join(", ")}</span>. Treat {final.unverified.length === 1 ? "it" : "them"} with
              care.
            </p>
          </div>
        </div>
      )}

      {final.charts.map((c) => {
        const src = final.sources[c.source_id];
        const show = !!showData[c.id];
        return (
          <figure key={c.id} className="chart-card">
            <figcaption>
              <p className="chart-title">{c.title}</p>
              <p className="chart-sub">
                <span className="mono">{c.source_id}</span>
                {src?.purpose ? <span> · {src.purpose}</span> : null}
              </p>
            </figcaption>
            <VegaChart spec={c.spec} label={c.title} />
            <div className="chart-foot">
              <button type="button" className="link-btn" aria-expanded={show} onClick={() => setShowData((s) => ({ ...s, [c.id]: !s[c.id] }))}>
                {show ? "Hide the data" : "Show the data"}
              </button>
              <button type="button" className="link-btn" onClick={() => onShowSource(c.source_id)}>
                Open the query
              </button>
            </div>
            {show && src && <ResultTable columns={src.columns} rows={src.rows} limit={50} total={src.row_count} truncated={src.truncated} caption={`Data for ${c.title}`} />}
          </figure>
        );
      })}

      {final.caveats?.length > 0 && (
        <ul className="caveats" aria-label="Caveats">
          {final.caveats.map((c, i) => (
            <li key={i}>
              <Info aria-hidden />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
