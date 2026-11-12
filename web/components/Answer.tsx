"use client";

// Renders the final answer. The text comes from a model that has read customer-written
// data, so it is never injected as HTML: a tiny Markdown subset is turned into React nodes,
// and every [nX] marker becomes a button that opens the query that produced the number.

import type { ReactNode } from "react";

import type { Citation, FinalData } from "@/lib/api";
import { IconAlert, IconInfo } from "./icons";
import { VegaChart } from "./VegaChart";
import { ResultTable } from "./ResultTable";
import { useState } from "react";

export interface Selection {
  sourceId: string;
  citation?: Citation;
  turnKey: string;
}

function inline(text: string, cites: Map<string, Citation>, onCite: (c: Citation) => void, active?: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[n\d+\])/g).map((part, i) => {
    if (!part) return null;
    const m = part.match(/^\[(n\d+)\]$/);
    if (m) {
      const c = cites.get(m[1]);
      if (!c) return <span key={i}>{part}</span>;
      return (
        <button
          key={i}
          type="button"
          className="cite"
          aria-pressed={active === c.id}
          onClick={() => onCite(c)}
          title={`From ${c.source_id}. Show the query behind this number.`}
        >
          {c.text}
          <sup>{c.source_id}</sup>
        </button>
      );
    }
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
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

export function AnswerBlock({
  final,
  turnKey,
  selection,
  onSelect,
}: {
  final: FinalData;
  turnKey: string;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const [showData, setShowData] = useState<Record<string, boolean>>({});
  const active = selection?.turnKey === turnKey ? selection.citation?.id : undefined;

  if (final.status === "refused") {
    return (
      <div className="notice neutral" role="status">
        <IconInfo />
        <div>
          <h3>Outside what Quarry can do</h3>
          <AnswerText text={final.answer} citations={[]} onCite={() => {}} />
        </div>
      </div>
    );
  }

  return (
    <section className="answer" aria-label="Answer">
      <AnswerText
        text={final.answer}
        citations={final.citations}
        active={active}
        onCite={(c) => onSelect({ sourceId: c.source_id, citation: c, turnKey })}
      />

      {final.unverified?.length > 0 && (
        <div className="notice warn" role="note" style={{ marginTop: 14 }}>
          <IconAlert />
          <p>
            {final.unverified.length === 1 ? "One check" : `${final.unverified.length} checks`} on this answer did not pass:
            some numbers could not be matched to a query result. Treat them with care.
          </p>
        </div>
      )}

      {final.charts.map((c) => {
        const src = final.sources[c.source_id];
        return (
          <figure key={c.id} className="chart-card" style={{ margin: "18px 0 0" }}>
            <figcaption>
              <p className="chart-title">{c.title}</p>
              <p className="chart-sub">
                From {c.source_id}
                {src?.purpose ? ` · ${src.purpose}` : ""} ·{" "}
                <button
                  type="button"
                  className="link-btn"
                  aria-expanded={!!showData[c.id]}
                  onClick={() => setShowData((s) => ({ ...s, [c.id]: !s[c.id] }))}
                >
                  {showData[c.id] ? "Hide data" : "Show data"}
                </button>
              </p>
            </figcaption>
            <VegaChart spec={c.spec} label={c.title} />
            {showData[c.id] && src && <ResultTable columns={src.columns} rows={src.rows} limit={50} truncated={src.truncated} />}
          </figure>
        );
      })}

      {final.caveats?.length > 0 && (
        <ul className="caveats" aria-label="Caveats">
          {final.caveats.map((c, i) => (
            <li key={i}>
              <IconInfo width={13} height={13} />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}

      {final.result_query_id && final.sources[final.result_query_id] && (
        <p className="result-caption" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="link-btn"
            onClick={() => onSelect({ sourceId: final.result_query_id!, turnKey })}
          >
            View the result table ({final.result_query_id})
          </button>
        </p>
      )}
    </section>
  );
}
