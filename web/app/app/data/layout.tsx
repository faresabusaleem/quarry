import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data sources",
  description: "The Olist marketplace dataset Quarry analyses: tables, columns, sample rows and the business glossary.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
