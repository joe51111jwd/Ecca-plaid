import type { NextConfig } from "next";

// Each parallel dev/e2e server can use its own build dir (NEXT_DIST_DIR) so several can run from one checkout.
const distDir = process.env.NEXT_DIST_DIR || ".next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  distDir,
  poweredByHeader: false,
  // Packages that must be loaded by Node at runtime rather than bundled (WASM / native / worker assets).
  serverExternalPackages: ["@electric-sql/pglite", "pg", "pdfjs-dist", "drizzle-kit"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // Embeddable surfaces may be framed by partner sites; everything else may not.
      { source: "/embed/:path*", headers: securityHeaders },
      {
        source: "/((?!embed/).*)",
        headers: [...securityHeaders, { key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
