import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "pdfjs-dist", "sharp"],
  experimental: {
    cpus: 2,
    serverActions: {
      bodySizeLimit: "2mb"
    }
  }
};

export default nextConfig;
