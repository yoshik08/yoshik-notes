import type { NextConfig } from "next";

// The app lives at yoshik.xyz/notes. yoshik-proxy forwards /notes/* here with
// the /notes prefix stripped, so the browser must request every URL (pages,
// API, and /_next assets) under /notes. Without assetPrefix the HTML asks for
// /_next/*, which the proxy sends to the personal site: blank page.
const nextConfig: NextConfig = {
  assetPrefix: "/notes",
  async rewrites() {
    // Same URLs when hit directly (localhost, *.vercel.app) instead of via the proxy.
    return {
      beforeFiles: [
        { source: "/notes", destination: "/" },
        { source: "/notes/:path*", destination: "/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
