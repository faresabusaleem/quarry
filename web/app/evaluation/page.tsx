import type { Metadata } from "next";

import { Redirect } from "@/components/Redirect";

export const metadata: Metadata = { title: "Benchmark", robots: { index: false } };

export default function Moved() {
  return <Redirect to="/app/benchmark/" label="Benchmark" />;
}
