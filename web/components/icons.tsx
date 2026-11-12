// A small, consistent line-icon set (1.5px strokes on a 16px grid). No icon fonts.

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const Mark = (props: P) => (
  <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden {...props}>
    <rect width="20" height="20" rx="4" fill="var(--accent)" />
    <path d="M5 5h7l3 3v7H5z" fill="var(--surface)" />
  </svg>
);

export const IconTables = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 6.5h12M6 6.5v7" />
  </svg>
);
export const IconColumns = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M6 2.5v11M10 2.5v11" />
  </svg>
);
export const IconRows = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
  </svg>
);
export const IconQuery = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="8" cy="4" rx="5" ry="1.8" />
    <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
  </svg>
);
export const IconCode = (p: P) => (
  <svg {...base(p)}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </svg>
);
export const IconChart = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 2.5v11h11" />
    <path d="M5.5 10.5v-3M8.5 10.5v-6M11.5 10.5v-4" />
  </svg>
);
export const IconQuestion = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3M8 11.5h0" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);
export const IconAlert = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 2 1.8 13h12.4z" />
    <path d="M8 6.5v3M8 11.3h0" />
  </svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);
export const IconChevron = (p: P) => (
  <svg {...base(p)} className={`chev ${p.className ?? ""}`}>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </svg>
);
export const IconArrow = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);
export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.3V11M8 5h0" />
  </svg>
);
export const IconShield = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 1.8 2.8 3.8v4c0 3 2.2 5.2 5.2 6.4 3-1.2 5.2-3.4 5.2-6.4v-4z" />
  </svg>
);
export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.3 1.5" />
  </svg>
);
export const IconSun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
  </svg>
);
export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
  </svg>
);
export const IconSend = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
  </svg>
);

export const TOOL_META: Record<string, { label: string; Icon: (p: P) => React.ReactElement }> = {
  list_tables: { label: "List tables", Icon: IconTables },
  describe_table: { label: "Describe table", Icon: IconColumns },
  sample_rows: { label: "Sample rows", Icon: IconRows },
  run_sql: { label: "Run SQL", Icon: IconQuery },
  run_python: { label: "Run Python", Icon: IconCode },
  make_chart: { label: "Make chart", Icon: IconChart },
  ask_user: { label: "Ask user", Icon: IconQuestion },
  final_answer: { label: "Answer", Icon: IconCheck },
};
