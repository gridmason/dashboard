import { defineConfig, devices } from '@playwright/test';

// Ports are overridable via env so a run can dodge a busy port (e.g. a parallel
// dev server on the default 5173) without editing this file. Defaults are the
// conventional ones; CI uses them as-is.
const PREVIEW_PORT = Number(process.env.GM_E2E_PREVIEW_PORT ?? '4173');
const DEV_PORT = Number(process.env.GM_E2E_DEV_PORT ?? '5173');
const DEV_WIDGET_PORT = Number(process.env.GM_E2E_WIDGET_PORT ?? '6070');
const ACK_WIDGET_PORT = Number(process.env.GM_E2E_ACK_WIDGET_PORT ?? '6071');
const API_PORT = Number(process.env.GM_E2E_API_PORT ?? '8787');
// The dev/preview servers proxy `/api` to this URL (vite.config.ts), so it must
// track API_PORT when that is overridden.
const API_URL = `http://localhost:${API_PORT}`;

/**
 * Playwright harness (FR-16). Two app surfaces are exercised:
 *
 * - **`chromium`** runs the suite against the built static bundle served by
 *   `vite preview` — the real **production** output, whose client sideload posture
 *   is the default `off` (no `GRIDMASON_SIDELOAD_MODE`). The sideload **gate** spec
 *   lives here: it proves dev sideload is absent from a production build **and** that
 *   with the posture off a registered acknowledged remote never enters the import
 *   map. It skips the dev-only sideload specs.
 * - **`chromium-dev`** runs the dev-sideload author-loop spec **and** the
 *   acknowledged-sideload spec against `vite dev` with the dev gate on
 *   (`GRIDMASON_DEV_SIDELOAD=1`, which turns on the dev-only CSP relaxation), plus
 *   the stand-in `gridmason dev` + acknowledged widget servers. The dev author loop
 *   ships in development builds only; the acknowledged spec drives the picker's
 *   register/place authoring flow (also dev-surfaced in Phase A), while the
 *   registration + hash-verified load it exercises is prod-safe.
 *
 * Run `npm run build` before `npm run e2e` (CI does both) so `vite preview` serves
 * a current bundle.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // The production-parity project: everything except the dev-server-driven
      // sideload specs (the dev author loop and the acknowledged register/place flow).
      testIgnore: ['**/sideload-dev.spec.ts', '**/sideload-acknowledged.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PREVIEW_PORT}` },
    },
    {
      name: 'chromium-dev',
      // The dev-server-driven sideload specs, run against the dev server with the gate on.
      testMatch: ['**/sideload-dev.spec.ts', '**/sideload-acknowledged.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DEV_PORT}` },
    },
  ],
  // Servers shared by both projects: the demo API (persistence backend), the
  // production preview, the dev server (dev sideload gate on), and the stand-in
  // `gridmason dev` widget server. The API starts from an empty, gitignored store
  // each run so the persistence/reset specs are deterministic.
  webServer: [
    {
      command: 'rm -rf e2e/.data && npm run api:start',
      env: {
        GRIDMASON_LAYOUT_STORE: 'e2e/.data/layouts.json',
        GRIDMASON_GOVERNANCE_STORE: 'e2e/.data/governance.json',
        GRIDMASON_SIDELOAD_STORE: 'e2e/.data/sideload.json',
        PORT: String(API_PORT),
      },
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npm run preview -- --port ${PREVIEW_PORT}`,
      env: { GRIDMASON_DEMO_API: API_URL },
      url: `http://localhost:${PREVIEW_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
      // The dev gate on: the dev-sideload CSP plugin permits localhost dev-server
      // origins in `script-src` (the relaxation exists only while the gate is on).
      // `GRIDMASON_SIDELOAD_MODE=acknowledged` bakes the client `acknowledged`
      // posture (src/sideload/policy.ts) so the acknowledged spec's register/place
      // flow admits its remote — the preview surface leaves it unset, so its client
      // posture stays `off` (the default) and the sideload-gate spec proves the block.
      env: { GRIDMASON_DEV_SIDELOAD: '1', GRIDMASON_SIDELOAD_MODE: 'acknowledged', GRIDMASON_DEMO_API: API_URL },
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'node e2e/fixtures/dev-widget-server.mjs',
      env: { DEV_WIDGET_PORT: String(DEV_WIDGET_PORT) },
      url: `http://localhost:${DEV_WIDGET_PORT}/gridmason.widget.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'node e2e/fixtures/acknowledged-widget-server.mjs',
      env: { ACK_WIDGET_PORT: String(ACK_WIDGET_PORT) },
      url: `http://localhost:${ACK_WIDGET_PORT}/gridmason.widget.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
