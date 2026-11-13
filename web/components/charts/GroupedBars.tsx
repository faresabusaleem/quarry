"use client";

// Horizontal grouped bars for rates (0 to 1), e.g. task success by category for the agent and
// the baseline. Brand chart rules: series colours in fixed order (Mineral for Quarry, Graphite
// for the baseline), thin bars with a rounded data end, a legend, values at the bar ends, a
// recessive grid, a tooltip on hover or focus, and a table view.

import { useId, useState } from "react";

export interface BarSeries {
  key: string;
  label: string;
  color: string; // a CSS variable, e.g. var(--series-2)
}
export interface BarGroup {
  label: string;
  note?: string; // e.g. "8 questions"
  values: Record<string, number | null>;
}

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

export function GroupedBars({ groups, series, caption }: { groups: BarGroup[]; series: BarSeries[]; caption: string }) {
  const [table, setTable] = useState(false);
  const id = useId();
  return (
    <figure className="gbars">
      <div className="gbars-head">
        <ul className="legend" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className="swatch" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <button type="button" className="link-btn" aria-expanded={table} aria-controls={id} onClick={() => setTable((t) => !t)}>
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap" id={id}>
          <table className="table">
            <caption className="visually-hidden">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="n">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.label}>
                  <th scope="row">
                    {g.label}
                    {g.note && <span className="muted"> · {g.note}</span>}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="n">
                      {pct(g.values[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="gbars-plot" id={id} role="list" aria-label={caption}>
          <div className="gbars-grid" aria-hidden>
            {[0, 25, 50, 75, 100].map((t) => (
              <span key={t} style={{ left: `${t}%` }}>
                <em>{t}%</em>
              </span>
            ))}
          </div>
          {groups.map((g) => (
            <div key={g.label} className="gbars-row" role="listitem" aria-label={`${g.label}: ${series.map((s) => `${s.label} ${pct(g.values[s.key])}`).join(", ")}`}>
              <div className="gbars-label">
                <span>{g.label}</span>
                {g.note && <small>{g.note}</small>}
              </div>
              <div className="gbars-bars">
                {series.map((s) => {
                  const v = g.values[s.key];
                  return (
                    <div key={s.key} className="gbars-bar-row" tabIndex={0} data-tip={`${s.label}: ${pct(v)}`}>
                      <span className="gbars-bar" style={{ width: `${(v ?? 0) * 100}%`, background: s.color }} />
                      <span className="gbars-value mono">{pct(v)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <figcaption className="visually-hidden">{caption}</figcaption>
    </figure>
  );
}
