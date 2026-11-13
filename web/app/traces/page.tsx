import type { Metadata } from "next";

import { Redirect } from "@/components/Redirect";

export const metadata: Metadata = { title: "Traces", robots: { index: false } };

export default function Moved() {
  return <Redirect to="/app/traces/" label="Traces" />;
}
