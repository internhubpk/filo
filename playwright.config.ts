import { defineConfig, devices } from '@playwright/test'

// =============================================================================
// Playwright E2E configuration.
//
// The suite boots the REAL Next.js dev server (`npm run dev`) and drives a
// real Chromium browser through signup / login / generation flows.
//
// Network boundary policy:
//   - Next.js API routes are 100% real code under test (auth validation,
//     HMAC tokens, error mapping, quota logic call paths).
//   - Only the external Convex cloud calls made from server routes are
//     intercepted via page.route() where a specific backend outcome is being
//     simulated (success / duplicate email / wrong password). A local Convex
//     deployment requires the project owner's credentials, which cannot be
//     committed; boundary interception keeps these tests deterministic.
//   - CONVEX_URL is pointed at a dead local port so any UNMOCKED Convex call
//     fails loudly and immediately instead of leaking into production data.
// =============================================================================

const PORT = Number(process.env.E2E_PORT ?? 3017)

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1366, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Dead-end Convex URL: anything unmocked fails fast & loud.
      CONVEX_URL: process.env.E2E_CONVEX_URL ?? 'http://127.0.0.1:9',
      NEXT_PUBLIC_CONVEX_URL: process.env.E2E_CONVEX_URL ?? 'http://127.0.0.1:9',
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
    },
  },
})
