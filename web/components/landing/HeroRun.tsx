"use client";

// The hero's product fragment: a real run (trace b61ed0c58fbf, Gemini 3.5 Flash Lite), drawn
// with the product's own parts. Clicking a cited number opens the query and the result row
// behind it, exactly as in the app. This is the page's one live thing.

import { ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { FacetIcon } from "@/components/brand/Logo";
import { highlightSql } from "@/lib/sql";
import type { Citation, FinalData } from "@/lib/api";
import { formatCell } from "@/lib/run";

function chartRows(final: FinalData): { label: string; value: number }[] {
  const chart = final.charts[0];
  const src = chart ? final.sources[chart.source_id] : undefined;
  if (!chart || !src) return [];
  const enc = chart.spec.encoding ?? {};
  const xi = src.columns.indexOf(enc.x?.field);
  const yi = src.columns.indexOf(enc.y?.field);
  return src.rows.map((r) => ({ label: String(r[xi]), value: Number(r[yi]) }));
}

export function HeroRun({ question, summary, final }: { question: string; summary: string; final: FinalData }) {
  const [open, setOpen] = useState<Citation | null>(null);
  const cites = new Map(final.citations.map((c) => [c.id, c]));
  const rows = chartRows(final);
  const max = Math.max(...rows.map((r) => r.value), 0.0001);
  const src = open ? final.sources[open.source_id] : undefined;

  const text: ReactNode[] = final.answer.split(/(\[[na]\d+\])/g).map((part, i) => {
    const m = part.match(/^\[([na]\d+)\]$/);
    const c = m ? cites.get(m[1]) : undefined;
    if (!c) return <span key={i}>{part}</span>;
    return (
      <button key={i} type="button" className="cite" aria-pressed={open?.id === c.id} onClick={() => setOpen(open?.id === c.id ? null : c)} aria-label={`${c.text}: show the query and result`}>
        <span className="cite-value">{c.text}</span>
        <span className="cite-src">{c.source_id}</span>
      </button>
    );
  });

  return (
    <div className="ui-run" data-ui>
      <p className="ui-question">{question}</p>
      <div className="ui-reply">
        <span className="ui-avatar" aria-hidden>
          <FacetIcon size={18} />
        </span>
        <div className="ui-body">
          <span className="ui-work">
            <ChevronRight aria-hidden /> {summary}
          </span>
          <p className="ui-answer">{text}</p>
          {open && src ? (
            <div className="ui-source" role="region" aria-label={`Source ${open.source_id}`}>
              <div className="ui-source-head">
                <span>
                  <b>{open.text}</b> comes from <span className="mono">{open.source_id}</span>: {src.purpose}
                </span>
                <button type="button" className="icon-btn sm" aria-label="Close the source" onClick={() => setOpen(null)}>
                  <X aria-hidden />
                </button>
              </div>
              <pre className="ui-sql">
                <code>{highlightSql(String(src.sql ?? "").trim())}</code>
              </pre>
              <table className="ui-table">
                <thead>
                  <tr>
                    {src.columns.map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {src.rows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      {r.map((v, j) => (
                        <td key={j} className={typeof v === "number" && Math.abs(v - open.value) < 1e-9 ? "hit" : undefined}>
                          {typeof v === "number" ? formatCell(Math.round(v * 10000) / 10000) : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <figure className="ui-chart">
              <figcaption>{final.charts[0]?.title}</figcaption>
              <div className="ui-bars" role="img" aria-label={rows.map((r) => `${r.label} ${Math.round(r.value * 1000) / 10}%`).join(", ")}>
                {rows.map((r) => (
                  <div key={r.label} className="ui-bar">
                    <span className="ui-bar-value">{(r.value * 100).toFixed(1)}%</span>
                    <span className="ui-bar-fill" style={{ height: `${(r.value / max) * 100}%` }} />
                    <span className="ui-bar-label">{r.label}</span>
                  </div>
                ))}
              </div>
            </figure>
          )}
        </div>
      </div>
    </div>
  );
}
