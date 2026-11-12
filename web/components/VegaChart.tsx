"use client";

// Renders a Vega-Lite spec produced by the make_chart tool with Quarry's chart theme.
// Colours come from CSS custom properties so the chart follows light and dark mode.

import { useEffect, useRef, useState } from "react";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function themeConfig() {
  const series = [1, 2, 3, 4, 5, 6].map((i) => cssVar(`--series-${i}`));
  const text = cssVar("--text");
  const muted = cssVar("--text-3");
  const grid = cssVar("--chart-grid");
  const axis = cssVar("--chart-axis");
  const font = getComputedStyle(document.body).fontFamily;
  return {
    background: "transparent",
    font,
    padding: { left: 4, right: 12, top: 8, bottom: 4 },
    view: { stroke: null },
    title: { anchor: "start", fontSize: 13, fontWeight: 600, color: text, offset: 12 },
    range: { category: series },
    mark: { color: series[0] },
    bar: { cornerRadiusEnd: 4, color: series[0], maxBandSize: 24 },
    line: { strokeWidth: 2, strokeCap: "round", strokeJoin: "round", color: series[0] },
    point: { size: 64, filled: true, color: series[0], stroke: cssVar("--chart-surface"), strokeWidth: 2 },
    area: { opacity: 0.12, line: { strokeWidth: 2 } },
    scale: { bandPaddingInner: 0.35 },
    axis: {
      labelColor: muted,
      titleColor: muted,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 500,
      gridColor: grid,
      gridWidth: 1,
      domainColor: axis,
      tickColor: axis,
      labelLimit: 180,
    },
    axisX: { grid: false, labelAngle: 0 },
    axisY: { domain: false, ticks: false, tickCount: 5 },
    legend: { labelColor: text, titleColor: muted, orient: "top", direction: "horizontal", symbolType: "square" },
  };
}

export function VegaChart({ spec, label }: { spec: Record<string, any>; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setTheme((t) => t + 1);
    mq.addEventListener("change", bump);
    const obs = new MutationObserver(bump);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", bump);
      obs.disconnect();
    };
  }, []);

  useEffect(() => {
    let view: { finalize: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { default: embed } = await import("vega-embed");
        if (cancelled || !ref.current) return;
        const { title: _title, ...rest } = spec; // the title is rendered in HTML above the chart
        const res = await embed(ref.current, { ...rest, autosize: { type: "fit-x", contains: "padding" } } as any, {
          actions: false,
          renderer: "svg",
          config: themeConfig() as any,
        });
        view = res.view;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec, theme]);

  if (error) return <p className="result-caption">Chart could not be drawn: {error}</p>;
  return <div ref={ref} className="chart" role="img" aria-label={label} />;
}
