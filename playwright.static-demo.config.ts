import { defineConfig, devices } from '@playwright/test';

// The static-demo (serverless) surface (issue #78). Unlike the main harness, there
// is NO demo API server and NO dev server: the target is the built static-demo
// bundle served by a plain static file server (`vite preview`), exactly as a
// GitHub Pages deploy would serve it. `npm run e2e:static-demo` builds the bundle
// (`build:static-demo`) before running this config.
const PORT = Number(process.env.GM_STATIC_DEMO_PORT ?? '4273');

export default defineConfig({
  testDir: './e2e/static-demo',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // A plain static server over the built static-demo bundle — no API, no proxy that
  // the app depends on. `reuseExistingServer` is off in CI so the run always serves
  // the freshly built bundle.
  webServer: {
    command: `npm run preview:static-demo -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
