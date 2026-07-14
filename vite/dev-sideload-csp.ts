/**
 * Dev-only CSP delivery for sideload (docs/SPEC.md §3 + §4, GW-D7).
 *
 * SPEC §4: the `dev` build adds the localhost dev-server origin to `script-src`
 * **only while the dev gate is on**; the **production CSP is never silently
 * relaxed**. This Vite plugin is that delivery channel, and it is honest by
 * construction:
 *
 * - `apply: 'serve'` — it runs for `vite dev` only. A production `vite build`
 *   never invokes it, so the built bundle / nginx image carries no CSP relaxation
 *   (an enforced production CSP is the separate M3 hardening, SPEC §7/§9). This is
 *   the "keep every channel honest" guarantee: the only place a script-src
 *   relaxation is introduced is here, dev-only.
 * - It emits a header **only when the owner opts in** by starting the dev server
 *   with `GRIDMASON_DEV_SIDELOAD=1` — the CSP-layer acknowledgement of the risk
 *   (the in-app owner acknowledgement is the session-layer gate). With the gate
 *   off, a normal `npm run dev` gets no CSP header at all — the dev experience is
 *   untouched, and no localhost origin is ever in `script-src`.
 *
 * The policy value itself comes from the single source of truth
 * ({@link buildDevCspHeader}), which permits the **class** of dev origins
 * (localhost / 127.0.0.1) — the specific per-session origin the dashboard will
 * actually import from is the client-side allowlist (nothing persisted).
 */
import type { Plugin } from 'vite';
import { buildDevCspHeader } from '../src/sideload/csp';

/** Env var the owner sets to opt the dev server into the sideload CSP relaxation. */
export const DEV_SIDELOAD_ENV = 'GRIDMASON_DEV_SIDELOAD';

/**
 * The dev-server origin **class** permitted in `script-src` while the gate is on.
 * A wildcard port covers whatever port `gridmason dev` binds; the exact origin is
 * further narrowed by the dashboard's per-session allowlist.
 */
export const DEV_SIDELOAD_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*'];

function gateEnabled(): boolean {
  const value = process.env[DEV_SIDELOAD_ENV];
  return value === '1' || value === 'true';
}

/** The Vite plugin that delivers the dev-sideload CSP header (serve mode only). */
export function devSideloadCsp(): Plugin {
  return {
    name: 'gridmason:dev-sideload-csp',
    apply: 'serve',
    configureServer(server) {
      if (!gateEnabled()) return; // gate off → no CSP header → dev experience untouched
      const header = buildDevCspHeader({
        dev: true,
        devSideloadEnabled: true,
        origins: DEV_SIDELOAD_ORIGINS,
      });
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Content-Security-Policy', header);
        next();
      });
    },
  };
}
