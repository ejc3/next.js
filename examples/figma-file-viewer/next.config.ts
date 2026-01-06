import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable static export for standalone deployment
  output: "export",
  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
