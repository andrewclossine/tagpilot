import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly files, pg has native fallbacks and PDFKit reads its font files from disk: load them from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "pdfkit"],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
