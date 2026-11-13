import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const BASE = "https://quarry-analyst.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/app/", "/app/benchmark/", "/app/data/"].map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
