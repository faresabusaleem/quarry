"use client";

import type { SchemaInfo, SourceRecord } from "@/lib/api";
import { formatMs } from "@/lib/run";
import type { Selection } from "./Answer";
import { Python, Sql } from "./Code";
import { IconShield, IconX } from "./icons";
import { ResultTable } from "./ResultTable";

export function SourceInspector({
  selection,
  source,
  onClose,
}: {
  selection: Selection;
  source: SourceRecord | undefined;
  onClose: () => void;
}) {
  const c = selection.citation;
  return (
    <div className="rail-section inspector" aria-live="polite">
      <div className="inspector-head">
        <div>
          <p className="rail-title">Source · {selection.sourceId}</p>
          <h3>{source?.purpose ?? (source?.kind === "python" ? "Python analysis" : "Query")}</h3>
        </div>
        <button type="button" className="icon-btn" aria-label="Close source" onClick={onClose}>
          <IconX />
        </button>
      </div>
      {c && (
        <div className="highlight-value">
          <b className="num">{c.text}</b>
          <span>
            Exact value in the result: <span className="mono">{c.value.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
          </span>
        </div>
      )}
      {!source ? (
        <p className="result-caption">This source is not available.</p>
      ) : (
        <>
          <dl className="kv">
            <dt>Kind</dt>
            <dd>{source.kind === "python" ? "Sandboxed Python" : "Read-only SQL (DuckDB)"}</dd>
            <dt>Rows</dt>
            <dd className="num">
              {source.row_count.toLocaleString("en-US")}
              {source.truncated ? "+ (capped)" : ""}
            </dd>
            <dt>Time</dt>
            <dd className="num">{formatMs(source.elapsed_ms)}</dd>
            {source.inputs && source.inputs.length > 0 && (
              <>
                <dt>Inputs</dt>
                <dd className="mono">{source.inputs.join(", ")}</dd>
              </>
            )}
          </dl>
          {source.sql && <Sql code={source.sql} />}
          {source.code && <Python code={source.code} />}
          <ResultTable columns={source.columns} rows={source.rows} limit={25} total={source.row_count} truncated={source.truncated} />
        </>
      )}
    </div>
  );
}

export function DatasetPanel({ schema }: { schema: SchemaInfo | null }) {
  const total = schema?.tables.reduce((s, t) => s + t.rows, 0) ?? 0;
  return (
    <>
      <div className="rail-section">
        <p className="rail-title">Dataset</p>
        <p style={{ margin: "0 0 10px", color: "var(--text-2)", fontSize: 13 }}>
          Brazilian E-Commerce Public Dataset by Olist. Real, anonymised marketplace orders, CC BY-NC-SA 4.0.
        </p>
        {!schema ? (
          <>
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </>
        ) : (
          <ul className="table-list">
            {schema.tables.map((t) => (
              <li key={t.name} title={t.description}>
                <span className="mono">{t.name}</span>
                <span className="num">{t.rows.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ul>
        )}
        {schema && (
          <p className="result-caption">
            {total.toLocaleString("en-US")} rows in {schema.tables.length} tables · <a href="/data/">Schema and glossary</a>
          </p>
        )}
      </div>
      <div className="rail-section">
        <p className="rail-title">Guardrails</p>
        <ul className="caveats" style={{ border: 0, margin: 0, padding: 0 }}>
          {[
            "The database is opened read-only by the engine; writes and file access are impossible.",
            "Every query is checked first: one SELECT, known tables only, row cap and time limit.",
            "Text from the data is treated as data. Instructions hidden in reviews are ignored.",
            "Every number in an answer must match a query result, or the answer is sent back.",
          ].map((g) => (
            <li key={g}>
              <IconShield width={13} height={13} />
              <span>{g}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
