"use client";

// The dataset Quarry analyses: licence, a schema browser (tables, columns, sample rows) and the
// business glossary the agent works from. Columns come from /api/schema; sample rows are
// exported from the warehouse at build time (scripts/export_site_data.py).

import { CircleAlert, ExternalLink, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { ResultTable } from "@/components/chat/ResultTable";
import { Markdown } from "@/components/Markdown";
import { getJson, type SchemaInfo } from "@/lib/api";
import samples from "@/lib/generated/samples.json";

const SAMPLES = samples as Record<string, { columns: string[]; rows: unknown[][] }>;

export default function DataPage() {
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<string>("orders");
  useEffect(() => {
    getJson<SchemaInfo>("/api/schema")
      .then(setSchema)
      .catch((e) => setError(String(e)));
  }, []);

  const t = schema?.tables.find((x) => x.name === table);
  const total = schema?.tables.reduce((s, x) => s + x.rows, 0) ?? 0;
  const sample = SAMPLES[table];

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Data source</p>
        <h1>Olist marketplace</h1>
        <p className="page-lead">
          The Brazilian E-Commerce Public Dataset by Olist: real, anonymised orders placed on a Brazilian marketplace between September 2016 and October 2018,
          across nine related tables. Quarry opens it read-only at the engine level, so a query can read but never change it.
        </p>
      </header>

      <dl className="stats">
        <div>
          <dt>Tables</dt>
          <dd>{schema ? schema.tables.length : "–"}</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd>{schema ? total.toLocaleString("en-US") : "–"}</dd>
        </div>
        <div>
          <dt>Orders</dt>
          <dd>{schema ? (schema.tables.find((x) => x.name === "orders")?.rows ?? 0).toLocaleString("en-US") : "–"}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd className="stat-icon">
            <Lock aria-hidden /> Read-only
          </dd>
        </div>
      </dl>

      <p className="licence">
        Licence: <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>, used non-commercially with attribution. Source:{" "}
        <a href="https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce">
          Kaggle <ExternalLink className="inline-icon" aria-hidden />
        </a>
        . The only rows Quarry adds are six labelled prompt-injection test reviews.
      </p>

      {error && (
        <div className="notice danger" role="alert">
          <CircleAlert aria-hidden />
          <div>
            <h3>The schema could not be loaded</h3>
            <p>{error}. The sample rows below are from the build.</p>
          </div>
        </div>
      )}

      <section className="section schema">
        <h2 className="section-title">Schema</h2>
        <div className="schema-grid">
          <nav className="schema-list" aria-label="Tables">
            {(schema?.tables ?? Object.keys(SAMPLES).map((name) => ({ name, rows: null as number | null }))).map((x) => (
              <button key={x.name} type="button" aria-current={x.name === table ? "true" : undefined} onClick={() => setTable(x.name)}>
                <span className="mono">{x.name}</span>
                {x.rows != null && <span className="mono muted">{x.rows.toLocaleString("en-US")}</span>}
              </button>
            ))}
          </nav>
          <div className="schema-detail">
            <h3 className="mono">{table}</h3>
            {t && <p className="muted">{t.description}</p>}
            {t ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Column</th>
                      <th scope="col">Type</th>
                      <th scope="col">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.columns.map((c) => (
                      <tr key={c.name}>
                        <td className="mono">{c.name}</td>
                        <td className="mono muted">{c.type}</td>
                        <td>{c.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !error && <div className="panel pad">{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</div>
            )}
            {sample && (
              <>
                <p className="block-label sample-label">Sample rows</p>
                <ResultTable columns={sample.columns} rows={sample.rows} limit={5} caption={`Sample rows from ${table}`} />
              </>
            )}
          </div>
        </div>
      </section>

      {schema?.glossary && (
        <section className="section">
          <h2 className="section-title">Business glossary</h2>
          <p className="section-lead muted">The definitions the agent and the baseline both work from. Choices like these are where two analysts can reasonably differ.</p>
          <Markdown source={schema.glossary} headingOffset={2} />
        </section>
      )}
    </div>
  );
}
