import { formatCell } from "@/lib/run";

export function ResultTable({
  columns,
  rows,
  limit = 10,
  total,
  truncated,
  caption = "Query result",
  highlight,
}: {
  columns: string[];
  rows: unknown[][];
  limit?: number;
  total?: number;
  truncated?: boolean;
  caption?: string;
  /** A value to mark in the table, e.g. the exact number behind a citation. */
  highlight?: number;
}) {
  const shown = rows.slice(0, limit);
  const count = total ?? rows.length;
  const isHit = (v: unknown) =>
    highlight !== undefined && typeof v === "number" && Math.abs(v - highlight) <= Math.max(1e-9, Math.abs(highlight) * 1e-9);
  return (
    <div className="result">
      <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className={`${typeof v === "number" ? "n" : ""} ${isHit(v) ? "hit" : ""}`} title={String(v ?? "NULL")}>
                    {typeof v === "number" ? formatCell(v) : <span className="cell">{formatCell(v)}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-caption num">
        {shown.length < count ? `First ${shown.length} of ` : ""}
        {count.toLocaleString("en-US")}
        {truncated ? "+" : ""} {count === 1 ? "row" : "rows"}
      </p>
    </div>
  );
}
