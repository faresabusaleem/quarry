import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Benchmark",
  description:
    "Quarry's agent against a single-shot text-to-SQL baseline: 89 questions with hand-written gold SQL and 25 held-out questions, with the error analysis.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
