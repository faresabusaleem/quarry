"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

// The theme lives on <html data-theme>. Without a saved choice it follows the system.
function subscribe(onChange: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    mq.removeEventListener("change", onChange);
    obs.disconnect();
  };
}

function isDark(): boolean {
  const set = document.documentElement.dataset.theme;
  return set ? set === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}

export function ThemeToggle({ withLabel = false, className = "" }: { withLabel?: boolean; className?: string }) {
  const dark = useDarkTheme();
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("quarry-theme", next);
    } catch {}
  };
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  const Icon = dark ? Sun : Moon;
  if (withLabel) {
    return (
      <button type="button" className={`nav-item ${className}`} onClick={toggle} aria-label={label}>
        <Icon aria-hidden />
        <span className="nav-label">{dark ? "Light theme" : "Dark theme"}</span>
      </button>
    );
  }
  return (
    <button type="button" className={`icon-btn ${className}`} onClick={toggle} aria-label={label} title={label}>
      <Icon aria-hidden />
    </button>
  );
}
