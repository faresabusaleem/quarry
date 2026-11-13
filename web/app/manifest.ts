import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quarry",
    short_name: "Quarry",
    description: "An AI analyst that shows its work.",
    start_url: "/app/",
    display: "standalone",
    background_color: "#f4f4f1",
    theme_color: "#16181b",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/app-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
