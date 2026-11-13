import { Fragment, type ReactNode } from "react";

import { parseInline, parseMarkdown, type Block, type ListBlock } from "@/lib/markdown";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) => {
        if (p.t === "strong") return <strong key={i}>{p.v}</strong>;
        if (p.t === "code") return <code key={i}>{p.v}</code>;
        if (p.t === "link") {
          // Relative links in the README point at the repository, not this site.
          const href = /^https?:/.test(p.href) || p.href.startsWith("#") ? p.href : `https://github.com/faresabusaleem/quarry/blob/main/${p.href.replace(/^\.\//, "")}`;
          return (
            <a key={i} href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer">
              {p.v}
            </a>
          );
        }
        return <Fragment key={i}>{p.v}</Fragment>;
      })}
    </>
  );
}

function List({ list }: { list: ListBlock }) {
  const items = list.items.map((it, i) => (
    <li key={i}>
      <Inline text={it.text} />
      {it.children && <List list={it.children} />}
    </li>
  ));
  return list.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
}

function render(b: Block, i: number, headingOffset: number): ReactNode {
  switch (b.type) {
    case "heading": {
      const level = Math.min(6, b.level + headingOffset);
      const Tag = `h${level}` as "h3";
      return (
        <Tag key={i}>
          <Inline text={b.text} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={i}>
          <Inline text={b.text} />
        </p>
      );
    case "list":
      return <List key={i} list={b} />;
    case "code":
      return (
        <pre key={i} className="code">
          <code>{b.text}</code>
        </pre>
      );
    case "table":
      return (
        <div key={i} className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {b.header.map((h, j) => (
                  <th key={j} scope="col" className={j > 0 ? "n" : undefined}>
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k} className={k > 0 ? "n" : undefined}>
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Renders trusted, repository-authored Markdown (analysis notes, README sections). */
export function Markdown({ source, headingOffset = 0, className = "prose" }: { source: string; headingOffset?: number; className?: string }) {
  return <div className={className}>{parseMarkdown(source).map((b, i) => render(b, i, headingOffset))}</div>;
}
