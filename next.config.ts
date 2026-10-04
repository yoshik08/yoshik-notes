import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served at yoshik.xyz/notes via a rewrite on the proxy — all routes
  // and assets live under the subpath.
  basePath: '/notes',
};

export default nextConfig;
