import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // NOTE: `ignoreBuildErrors` was previously `true`, which masked ~138 real
  // TypeScript errors across the codebase. Phase 1 of the production-readiness
  // hardening pass fixed every one of them, so we now enforce strict type
  // checking at build time. If `next build` starts failing after a change,
  // fix the type error rather than re-enabling this flag.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
