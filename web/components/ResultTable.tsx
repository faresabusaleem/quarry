import { formatCell } from "@/lib/run";

export function ResultTable({
  columns,
  rows,
  limit = 10,
  total,
  truncated,
  caption,
}: {
  columns: string[];
  rows: unknown[][];
  limit?: number;
  total?: number;
  truncated?: boolean;
  caption?: string;
}) {
  const shown = rows.slice(0, limit);
  const count = total ?? rows.length;
  return (
    <>
      <div className="result" tabIndex={0} role="region" aria-label={caption ?? "Query result"}>
        <table>
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
                  <td key={j} className={typeof v === "number" ? "n" : undefined} title={String(v ?? "NULL")}>
                    {formatCell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="result-caption">
        {shown.length < count ? `First ${shown.length} of ` : ""}
        {count.toLocaleString("en-US")}
        {truncated ? "+" : ""} row{count === 1 ? "" : "s"}
      </p>
    </>
  );
}
