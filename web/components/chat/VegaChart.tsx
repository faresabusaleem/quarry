"use client";

// Draws a Vega-Lite spec from the make_chart tool in Quarry's chart style. Colours and type
// come from the theme tokens, so charts follow light and dark mode (docs/brand.md, Charts).

import { useEffect, useRef, useState } from "react";

import { useDarkTheme } from "@/components/ThemeToggle";

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function chartConfig() {
  const series = [1, 2, 3, 4, 5, 6].map((i) => token(`--series-${i}`));
  const text = token("--text");
  const muted = token("--text-2");
  const font = getComputedStyle(document.body).fontFamily;
  return {
    background: "transparent",
    font,
    padding: { left: 2, right: 8, top: 6, bottom: 2 },
    view: { stroke: null, continuousHeight: 220, discreteHeight: { step: 22 } },
    range: { category: series },
    mark: { color: series[0] },
    bar: { cornerRadiusEnd: 4, color: series[0] },
    line: { strokeWidth: 2, strokeCap: "round", strokeJoin: "round", color: series[0] },
    point: { size: 56, filled: true, color: series[0], stroke: token("--chart-surface"), strokeWidth: 2 },
    area: { opacity: 0.14, line: { strokeWidth: 2 } },
    scale: { bandPaddingInner: 0.55, bandPaddingOuter: 0.3 },
    axis: {
      labelColor: muted,
      titleColor: muted,
      labelFont: font,
      titleFont: font,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 500,
      gridColor: token("--chart-grid"),
      gridWidth: 1,
      domainColor: token("--chart-axis"),
      tickColor: token("--chart-axis"),
      labelLimit: 160,
      labelPadding: 6,
    },
    axisX: { grid: false, labelAngle: 0, labelOverlap: "parity" },
    axisY: { domain: false, ticks: false, tickCount: 5 },
    legend: { labelColor: text, titleColor: muted, orient: "top", direction: "horizontal", symbolType: "square", labelFont: font },
  };
}

export function VegaChart({ spec, label }: { spec: Record<string, unknown>; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = useDarkTheme();

  useEffect(() => {
    let view: { finalize: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { default: embed } = await import("vega-embed");
        if (cancelled || !ref.current) return;
        const { title: _title, ...rest } = spec; // the title is set in HTML above the chart
        const res = await embed(ref.current, { ...rest, autosize: { type: "fit-x", contains: "padding" } } as never, {
          actions: false,
          renderer: "svg",
          config: chartConfig() as never,
        });
        view = res.view;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec, dark]);

  if (error) return <p className="table-caption">This chart could not be drawn ({error}). Its data is below.</p>;
  return <div ref={ref} className="chart" role="img" aria-label={label} />;
}
