import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served at yoshik.xyz/notes via the proxy, which strips the /notes prefix.
  // No basePath — all internal paths use explicit /notes prefix.
};

export default nextConfig;
