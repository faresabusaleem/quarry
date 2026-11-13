"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { Citation, SourceRecord } from "@/lib/api";
import { formatMs } from "@/lib/run";
import { PlainBlock, SqlBlock } from "./Code";
import { ResultTable } from "./ResultTable";

export function Inspector({
  sourceId,
  source,
  citation,
  onClose,
}: {
  sourceId: string;
  source: SourceRecord | undefined;
  citation?: Citation;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sourceId, citation?.id]);

  return (
    <aside className="inspector" aria-label={`Source ${sourceId}`}>
      <header className="inspector-head">
        <div>
          <p className="eyebrow">
            Source <span className="mono">{sourceId}</span>
          </p>
          <h2>{source?.purpose || (source?.kind === "python" ? "Python analysis" : "Query")}</h2>
        </div>
        <button ref={closeRef} type="button" className="icon-btn" aria-label="Close the source" onClick={onClose}>
          <X aria-hidden />
        </button>
      </header>
      <div className="inspector-body">
        {citation && (
          <div className="inspector-value">
            <p className="inspector-figure">{citation.text}</p>
            <p className="muted">
              Exact value in the result:{" "}
              <span className="mono">{citation.value.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
            </p>
          </div>
        )}
        {!source ? (
          <p className="muted">This source is not available for this run.</p>
        ) : (
          <>
            <dl className="facts">
              <div>
                <dt>Engine</dt>
                <dd>{source.kind === "python" ? "Sandboxed Python" : "DuckDB, read-only"}</dd>
              </div>
              <div>
                <dt>Rows</dt>
                <dd className="mono">
                  {source.row_count.toLocaleString("en-US")}
                  {source.truncated ? "+" : ""}
                </dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd className="mono">{formatMs(source.elapsed_ms)}</dd>
              </div>
            </dl>
            {source.sql && <SqlBlock code={source.sql} />}
            {source.code && <PlainBlock code={source.code} label="Python" />}
            <ResultTable
              columns={source.columns}
              rows={source.rows}
              limit={50}
              total={source.row_count}
              truncated={source.truncated}
              caption={`Result ${sourceId}`}
              highlight={citation?.value}
            />
          </>
        )}
      </div>
    </aside>
  );
}
