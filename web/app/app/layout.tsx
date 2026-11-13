import type { Metadata } from "next";

import { AppShell } from "@/components/shell/AppShell";
import "./app.css";
import "./pages.css";

export const metadata: Metadata = {
  title: "Analysis",
  description: "Ask Quarry a question about the Olist marketplace and watch it plan, query, recover and cite every number.",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
