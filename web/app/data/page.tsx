"use client";

import { useEffect, useState } from "react";

import { getJson, type SchemaInfo } from "@/lib/api";

export default function DataPage() {
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJson<SchemaInfo>("/api/schema").then(setSchema).catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Data</h1>
          <p className="sub">
            The <a href="https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce">Brazilian E-Commerce Public Dataset by Olist</a>{" "}
            (CC BY-NC-SA 4.0): about 99,000 real, anonymised orders from a Brazilian marketplace, September 2016 to
            October 2018. Quarry loads it into a read-only DuckDB file. Six rows in <code>order_reviews</code> with ids
            starting <code>injtest-</code> are synthetic prompt-injection tests; nothing else is added.
          </p>
        </div>
      </div>

      {error && (
        <div className="panel state">
          <h2>Could not load the schema</h2>
          <p>{error}</p>
        </div>
      )}
      {!schema && !error && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}

      {schema && (
        <>
          <section className="section" style={{ marginTop: 0 }}>
            <h2>Tables</h2>
            <div className="panel">
              {schema.tables.map((t, i) => (
                <details key={t.name} className="table-details" open={i === 0}>
                  <summary>
                    <span>
                      <span className="mono strong" style={{ fontWeight: 600 }}>{t.name}</span>
                      <span style={{ color: "var(--text-2)", marginLeft: 10 }}>{t.description}</span>
                    </span>
                    <span className="num" style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>
                      {t.rows.toLocaleString("en-US")} rows
                    </span>
                  </summary>
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table">
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
                            <td className="mono" style={{ color: "var(--text-3)" }}>{c.type}</td>
                            <td>{c.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="section">
            <h2>Business glossary</h2>
            <p className="prose">
              The agent, the baseline and the hand-written ground truth all use these definitions, so every system is
              graded against the same meaning of &ldquo;revenue&rdquo; or &ldquo;last quarter&rdquo;.
            </p>
            <div className="panel">
              <pre className="glossary">{schema.glossary}</pre>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
