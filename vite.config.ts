import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devSideloadCsp } from './vite/dev-sideload-csp';

// The demo API (server/) the persistence adapter talks to. Dev and preview both
// proxy `/api` to it so the SPA and the API are same-origin — the `HttpOnly`
// stub-login cookie then rides every layout call automatically (SPEC §6). A real
// deployment fronts the static bundle and the API under one origin the same way.
const DEMO_API_TARGET = process.env.GRIDMASON_DEMO_API ?? 'http://localhost:8787';
const apiProxy = { '/api': { target: DEMO_API_TARGET, changeOrigin: true } };

// The client-side sideload posture (SPEC §4): `off` (default), `dev`, or
// `acknowledged`. Baked into the bundle as a define so the browser's import-map
// admission (`src/sideload/policy.ts`) reads it. Unset builds default to `off` —
// a production `vite build`/`preview` with no env admits no sideloaded remote —
// so a deploy opts into `acknowledged` explicitly. Any unknown value resolves to
// `off` client-side; this only forwards the raw string.
const SIDELOAD_MODE = process.env.GRIDMASON_SIDELOAD_MODE ?? 'off';

// Static bundle is emitted to dist/ and served from the app image (Dockerfile)
// or any static host (FR-17). Absolute base: this is a client-routed SPA, so
// deep links (/p/:pageType/:entityId) must load assets from an absolute path,
// not one relative to the current route.
export default defineConfig({
  // `devSideloadCsp` is a serve-only plugin: it delivers the dev-sideload CSP
  // relaxation for `vite dev` (and only when the owner opts in), and is inert for
  // `vite build`, so the production bundle carries no CSP relaxation (SPEC §4).
  plugins: [react(), devSideloadCsp()],
  define: {
    __GM_SIDELOAD_MODE__: JSON.stringify(SIDELOAD_MODE),
  },
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
});
