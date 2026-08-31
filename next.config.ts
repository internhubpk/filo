import type { NextConfig } from "next";

// `output: "standalone"` exists for SELF-HOSTED deployments (it produces
// .next/standalone/server.js used by `npm run start` behind Caddy/Docker).
// On Vercel it is unnecessary (the platform serves its own build output) and
// has historically caused asset/hydration issues, so it is DISABLED when
// building on Vercel — the VERCEL env var is always set to "1" there.
const isVercelBuild = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  ...(isVercelBuild ? {} : { output: "standalone" as const }),
  // NOTE: `ignoreBuildErrors` was previously `true`, which masked ~138 real
  // TypeScript errors across the codebase. Phase 1 of the production-readiness
  // hardening pass fixed every one of them, so we now enforce strict type
  // checking at build time. If `next build` starts failing after a change,
  // fix the type error rather than re-enabling this flag.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // pdfkit resolves its .afm font-metric files at runtime via __dirname
  // (node_modules/pdfkit/js/data/*.afm). When the bundler inlines pdfkit,
  // those paths become /ROOT/node_modules/... and every PDF render crashes
  // with ENOENT. Marking it external keeps the real package on disk so the
  // metrics load — this is what made every PDF job fail in the render step.
  serverExternalPackages: ["pdfkit", "fontkit", "sharp"],
  // The bundled document fonts (assets/fonts) are resolved at RUNTIME by
  // services/typography/fonts.ts. Trace them into the serverless bundle for
  // every route that can render artifacts, so PDF/SVG rasterization stays
  // deterministic on any deployment.
  outputFileTracingIncludes: {
    "/api/generation/render": ["./assets/fonts/**"],
    "/api/artifacts/[id]/export": ["./assets/fonts/**"],
    "/api/artifacts/export-zip": ["./assets/fonts/**"],
    "/api/artifacts/agent-generate": ["./assets/fonts/**"],
  },
};

export default nextConfig;
