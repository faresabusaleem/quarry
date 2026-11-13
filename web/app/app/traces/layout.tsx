import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Traces",
  description: "Every run's model calls and tool calls on one timeline, with tokens, latency and cost.",
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
