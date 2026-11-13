// The Facet icon and the quarry lockup, drawn inline so they take their colours from the
// theme tokens (--logo-*) and the landing page can animate the facet. Geometry: docs/brand.md.

import { LOCKUP, WORDMARK_PATH } from "./geometry";

const HEX = "60,12 102,36 102,84 60,108 18,84 18,36";
const FACET = "60,12 102,36 60,60";
const LINES = "M60 60L18 36M60 60L60 108M60 60L102 84";

function Stone({ lines }: { lines: boolean }) {
  return (
    <>
      <polygon points={HEX} fill="var(--logo-body)" />
      <polygon className="facet" points={FACET} fill="var(--logo-facet)" />
      {lines && <path d={LINES} stroke="var(--logo-lines)" strokeWidth={3} fill="none" />}
    </>
  );
}

/** The icon alone. At 32 px and below the facet lines are dropped, as the brand requires. */
export function FacetIcon({ size = 20, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Stone lines={size > 32} />
    </svg>
  );
}

/** Icon + wordmark. `height` is the rendered height of the whole lockup in px. */
export function Logo({ height = 22, className }: { height?: number; className?: string }) {
  const [, , w, h] = LOCKUP.viewBox.split(" ").map(Number);
  return (
    <svg
      viewBox={LOCKUP.viewBox}
      height={height}
      width={(height * w) / h}
      className={className}
      role="img"
      aria-label="Quarry"
    >
      <g transform={LOCKUP.icon}>
        <Stone lines={height * 0.8 > 26} />
      </g>
      <path transform={LOCKUP.text} d={WORDMARK_PATH} fill="var(--logo-text)" />
    </svg>
  );
}
