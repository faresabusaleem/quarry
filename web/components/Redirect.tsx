"use client";

// Old URLs from before the redesign, kept working: the static export cannot redirect on the
// server, so the page forwards in the browser and keeps the query string (e.g. ?id=<run>).

import { useEffect } from "react";

export function Redirect({ to, label }: { to: string; label: string }) {
  useEffect(() => {
    window.location.replace(`${to}${window.location.search}${window.location.hash}`);
  }, [to]);
  return (
    <main style={{ padding: "var(--space-10) var(--space-5)", textAlign: "center" }}>
      <p>
        This page moved to <a href={to}>{label}</a>.
      </p>
    </main>
  );
}
