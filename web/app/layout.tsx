import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";

import "./tokens.css";
import "./base.css";

// Self-hosted by next/font: Latin subset, size-adjusted fallbacks, no layout shift.
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const DESCRIPTION =
  "Quarry is an open-source AI data analyst. It plans, explores the schema, writes and fixes its own SQL, draws charts and links every number in its answer to the query behind it.";

export const metadata: Metadata = {
  metadataBase: new URL("https://quarry-analyst.vercel.app"),
  title: { default: "Quarry: an AI analyst that shows its work", template: "%s · Quarry" },
  description: DESCRIPTION,
  applicationName: "Quarry",
  authors: [{ name: "Fares AbuSaleem" }],
  icons: {
    icon: [
      { url: "/brand/favicon.ico", sizes: "48x48" },
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Quarry",
    url: "/",
    title: "Quarry: an AI analyst that shows its work",
    description: DESCRIPTION,
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "Quarry. An AI analyst that shows its work." }],
  },
  twitter: { card: "summary_large_image", title: "Quarry: an AI analyst that shows its work", description: DESCRIPTION, images: ["/brand/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#171819" },
  ],
};

// Applies a saved theme before first paint, so there is no flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem('quarry-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
