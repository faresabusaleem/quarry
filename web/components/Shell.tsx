"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { getJson, type Health } from "@/lib/api";
import { IconMoon, IconSun, Mark } from "./icons";

const NAV = [
  { href: "/", label: "Ask" },
  { href: "/traces/", label: "Traces" },
  { href: "/evaluation/", label: "Evaluation" },
  { href: "/data/", label: "Data" },
];

function subscribeTheme(onChange: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    mq.removeEventListener("change", onChange);
    obs.disconnect();
  };
}

function isDarkNow(): boolean {
  const set = document.documentElement.dataset.theme;
  return set ? set === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function ThemeToggle() {
  // The theme lives on <html data-theme>; this subscribes to it instead of copying it into state.
  const dark = useSyncExternalStore(subscribeTheme, isDarkNow, () => false);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("quarry-theme", next);
    } catch {}
  };
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={dark ? "Use light theme" : "Use dark theme"}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    getJson<Health>("/api/health")
      .then(setHealth)
      .catch(() => setOffline(true));
  }, [pathname]);

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link href="/" className="wordmark" aria-label="Quarry home">
          <Mark />
          <span>quarry</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-right">
          {offline ? (
            <span className="model-pill">
              <span className="dot off" /> API offline
            </span>
          ) : health ? (
            <span className="model-pill" title={`Provider: ${health.provider}`}>
              <span className={`dot ${health.ok ? "" : "off"}`} />
              <span className="mono">{health.model ?? health.provider}</span>
            </span>
          ) : null}
          <ThemeToggle />
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
