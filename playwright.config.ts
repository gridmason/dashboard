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
  webServer: {
    command: 'npm run preview',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
