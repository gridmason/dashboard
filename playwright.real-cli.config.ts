import { defineConfig, devices } from '@playwright/test';

/**
 * The **optional, non-hermetic** real-CLI verification (issue #38), kept out of
 * the default matrix (`playwright.config.ts`) because it downloads and runs the
 * published `@gridmason/cli` over the network. Run it deliberately:
 *
 *   npm run e2e:real-cli
 *
 * It closes issue #11's openly-deferred acceptance criterion — a widget served by
 * the **real** `gridmason dev` hot-loads into the running dashboard on a governed
 * page — by standing up three servers and driving the author loop against them:
 *
 * - the demo API (so the dashboard boots),
 * - `vite dev` with the dev-sideload gate on (`GRIDMASON_DEV_SIDELOAD=1`),
 * - the real `@gridmason/cli@0.0.1 dev` serving `e2e/fixtures/real-cli-widget/`.
 *
 * The fixture widget is deliberately self-contained (no bare `@gridmason/*`
 * imports) so the check asserts the part this repo owns: the dev-server transport
 * (`/@dev/manifest` -> entry -> mount -> badge). A *scaffold-template* widget
 * imports `@gridmason/sdk` by bare specifier and does not resolve in the dashboard
 * yet — that gap (a shared `@gridmason/*` import scope) is documented in
 * docs/sideload.md, not covered here.
 *
 * Ports are overridable via the same `GM_E2E_*` env vars as the default config,
 * with distinct defaults so this can run alongside the hermetic matrix.
 */
const DEV_PORT = Number(process.env.GM_E2E_REAL_DEV_PORT ?? '5174');
const API_PORT = Number(process.env.GM_E2E_REAL_API_PORT ?? '8788');
const CLI_PORT = Number(process.env.GM_E2E_REAL_CLI_PORT ?? '6090');
const CLI_VERSION = process.env.GM_E2E_CLI_VERSION ?? '0.0.1';
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './e2e/real-cli',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: { trace: 'on-first-retry', baseURL: `http://localhost:${DEV_PORT}` },
  projects: [
    { name: 'chromium-real-cli', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'rm -rf e2e/.data-real-cli && npm run api:start',
      env: {
        GRIDMASON_LAYOUT_STORE: 'e2e/.data-real-cli/layouts.json',
        GRIDMASON_GOVERNANCE_STORE: 'e2e/.data-real-cli/governance.json',
        GRIDMASON_SIDELOAD_STORE: 'e2e/.data-real-cli/sideload.json',
        PORT: String(API_PORT),
      },
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
      env: { GRIDMASON_DEV_SIDELOAD: '1', GRIDMASON_SIDELOAD_MODE: 'dev', GRIDMASON_DEMO_API: API_URL },
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The REAL published CLI, pinned. Downloads on first run (non-hermetic).
      command: `npx --yes @gridmason/cli@${CLI_VERSION} dev --port ${CLI_PORT}`,
      cwd: 'e2e/fixtures/real-cli-widget',
      url: `http://127.0.0.1:${CLI_PORT}/@dev/manifest`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
