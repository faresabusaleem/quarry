import type { NextConfig } from "next";

// Static export: FastAPI serves the built files from the same origin in production, so the
// demo is a single container and the browser never needs CORS.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
