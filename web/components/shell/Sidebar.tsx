"use client";

import { ChartColumn, Database, Activity, PanelLeftClose, PanelLeftOpen, SquarePen, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { FacetIcon, Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { groupByDate } from "@/lib/conversations";
import { useStore } from "@/lib/store";

const NAV = [
  { href: "/app/data/", label: "Data sources", Icon: Database },
  { href: "/app/benchmark/", label: "Benchmark", Icon: ChartColumn },
  { href: "/app/traces/", label: "Traces", Icon: Activity },
];

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  drawer,
  onClose,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  drawer: boolean;
  onClose: () => void;
}) {
  const { conversations, active, startNew, open, remove, busy } = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const groups = groupByDate(conversations);
  const inChat = pathname === "/app" || pathname === "/app/";

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <nav className={`sidebar ${collapsed && !drawer ? "collapsed" : ""}`} aria-label="Quarry">
      <div className="sidebar-top">
        {collapsed && !drawer ? (
          <Link href="/" className="sidebar-mark" aria-label="Quarry home">
            <FacetIcon size={24} />
          </Link>
        ) : (
          <Link href="/" className="sidebar-logo" aria-label="Quarry home">
            <Logo height={22} />
          </Link>
        )}
        {drawer ? (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
            <X aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn collapse-btn"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </button>
        )}
      </div>

      <button
        type="button"
        className="new-analysis"
        onClick={() => {
          startNew();
          go("/app/");
        }}
        title="New analysis"
      >
        <SquarePen aria-hidden />
        <span className="nav-label">New analysis</span>
      </button>

      <div className="history" aria-label="Recent analyses">
        {groups.length === 0 ? (
          <p className="history-empty nav-label">Your analyses appear here. They are saved in this browser only.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="history-group">
              <h2 className="history-label">{g.label}</h2>
              <ul>
                {g.items.map((c) => {
                  const current = inChat && active?.id === c.id;
                  const running = busy && current;
                  return (
                    <li key={c.id} className={`history-item ${current ? "current" : ""}`}>
                      <button
                        type="button"
                        className="history-link"
                        aria-current={current ? "page" : undefined}
                        onClick={() => {
                          open(c.id);
                          go(`/app/?c=${c.id}`);
                        }}
                      >
                        {running && <span className="spinner" aria-label="Running" />}
                        <span className="history-title">{c.title}</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn sm history-delete"
                        aria-label={`Delete "${c.title}"`}
                        onClick={() => remove(c.id)}
                        disabled={running}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="sidebar-bottom">
        {NAV.map(({ href, label, Icon }) => {
          const current = pathname.startsWith(href.replace(/\/$/, ""));
          return (
            <Link key={href} href={href} className="nav-item" aria-current={current ? "page" : undefined} onClick={onClose} title={label}>
              <Icon aria-hidden />
              <span className="nav-label">{label}</span>
            </Link>
          );
        })}
        <ThemeToggle withLabel />
      </div>
    </nav>
  );
}
