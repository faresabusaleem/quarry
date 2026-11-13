import type { Metadata } from "next";

import { Redirect } from "@/components/Redirect";

export const metadata: Metadata = { title: "Data sources", robots: { index: false } };

export default function Moved() {
  return <Redirect to="/app/data/" label="Data sources" />;
}
