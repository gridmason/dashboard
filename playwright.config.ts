import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * Playwright harness (FR-16). The boot smoke test runs against the built static
 * bundle served by `vite preview`, so it exercises the real production output.
 * Run `npm run build` before `npm run e2e` (CI does both). The e2e matrix
 * (add-widget gating, governance, error boundary, sideload gate) grows here as
 * later epics land; for the D-E0 scaffold it is a single boot check.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Two servers: the demo API (persistence backend) and the static preview that
  // proxies `/api` to it (vite.config.ts). The API starts from an empty,
  // gitignored layout store each run so the persistence/reset specs are
  // deterministic — a stale user override must never leak between runs.
  webServer: [
    {
      command: 'rm -rf e2e/.data && npm run api:start',
      env: { GRIDMASON_LAYOUT_STORE: 'e2e/.data/layouts.json', PORT: '8787' },
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run preview',
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
