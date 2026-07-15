import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devSideloadCsp, isDevSideloadGateEnabled } from './vite/dev-sideload-csp';
import { SIDELOAD_IMPORT_MAP, devSideloadImportScope } from './vite/dev-sideload-import-scope';

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
  // `devSideloadCsp` and `devSideloadImportScope` are serve-only plugins gated on
  // the same `GRIDMASON_DEV_SIDELOAD` opt-in: the first delivers the dev-sideload
  // CSP relaxation, the second injects the `@gridmason/*` import map that lets a
  // sideloaded scaffold-template widget resolve its bare specifiers (issue #40).
  // Both are inert for `vite build`, so the production bundle carries neither the
  // CSP relaxation nor the import map (SPEC §4).
  plugins: [react(), devSideloadCsp(), devSideloadImportScope()],
  define: {
    __GM_SIDELOAD_MODE__: JSON.stringify(SIDELOAD_MODE),
  },
  base: '/',
  // When the dev-sideload gate is on, force-bundle the `@gridmason/*` modules the
  // import scope maps (`dev-sideload-import-scope.ts`). A sideloaded widget imports
  // these only at runtime, and the app itself imports `@gridmason/sdk` (root) only
  // as a *type* — so without this Vite first discovers the dep when the widget
  // loads, re-optimizes, and issues a **full-page reload**, which would wipe the
  // per-session sideload widget mid-flight (and, being global, disrupt other dev
  // pages too). Pre-bundling them at server start keeps that first import reload-
  // free. Dev-only: `optimizeDeps` does not affect `vite build`. Spread so the key
  // is simply absent when the gate is off (not set to `undefined`, which
  // `exactOptionalPropertyTypes` rejects).
  ...(isDevSideloadGateEnabled()
    ? { optimizeDeps: { include: Object.keys(SIDELOAD_IMPORT_MAP) } }
    : {}),
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The shell-owned verifying Service Worker (FR-11, src/sw/federated-sw.ts) is a
    // second entry emitted to the bundle **root** as `federated-sw.js` (not under
    // assetsDir), so it is served from `/federated-sw.js` and can register with scope
    // `/` — a nested `/assets/…` path would be scoped to `/assets/` and never control
    // the app. Every other chunk keeps Vite's default hashed `assets/[name]-[hash]`.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'federated-sw': fileURLToPath(new URL('./src/sw/federated-sw.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'federated-sw' ? 'federated-sw.js' : 'assets/[name]-[hash].js',
      },
    },
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
