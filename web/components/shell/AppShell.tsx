"use client";

import { Menu, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { ConversationProvider, useStore } from "@/lib/store";
import { Sidebar } from "./Sidebar";

const COLLAPSE_KEY = "quarry-sidebar-collapsed";

function MobileBar({ onMenu }: { onMenu: () => void }) {
  const { startNew } = useStore();
  const router = useRouter();
  return (
    <header className="mobile-bar">
      <button type="button" className="icon-btn" onClick={onMenu} aria-label="Open menu">
        <Menu aria-hidden />
      </button>
      <Link href="/" aria-label="Quarry home" className="mobile-logo">
        <Logo height={20} />
      </Link>
      <button
        type="button"
        className="icon-btn"
        aria-label="New analysis"
        onClick={() => {
          startNew();
          router.push("/app/");
        }}
      >
        <SquarePen aria-hidden />
      </button>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Read the saved preference after hydration, so server and client render the same markup.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Links in the drawer close it; Escape closes it; focus moves into it when it opens.
  useEffect(() => {
    if (!drawer) return;
    drawerRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });

  return (
    <div className={`app ${collapsed ? "is-collapsed" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="sidebar-dock">
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} drawer={false} onClose={() => {}} />
      </div>
      <MobileBar onMenu={() => setDrawer(true)} />
      {drawer && (
        <div className="drawer" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden />
          <div className="drawer-panel" ref={drawerRef}>
            <Sidebar collapsed={false} onToggleCollapsed={() => {}} drawer onClose={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <main id="main" className="app-main">
        {children}
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ConversationProvider>
      <Shell>{children}</Shell>
    </ConversationProvider>
  );
}
