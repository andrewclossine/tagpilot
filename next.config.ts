import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly files, pg has native fallbacks and PDFKit reads its font files from disk: load them from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "pdfkit"],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  poweredByHeader: false,
  async headers() {
    const security = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ];
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
