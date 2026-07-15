/**
 * Production-CSP delivery for the preview server (docs/SPEC.md §3, FR-13).
 *
 * The enforced production policy is served by the app image (`docker/nginx.conf`)
 * and, for a static host, rendered as a `<meta>` tag (docs/csp.md). This plugin is
 * the **validation** channel: `vite preview` serves the same policy — built from
 * the single source of truth ({@link buildProductionCspHeader}) — as a
 * `Content-Security-Policy-Report-Only` header, so the e2e report-only run
 * (`e2e/csp.spec.ts`) can drive the real production bundle and assert **zero**
 * violations across the demo flows before the header is enforced.
 *
 * It hooks `configurePreviewServer`, so it runs for `vite preview` **only** — never
 * for `vite dev` (whose HMR needs inline/eval scripts the strict production policy
 * forbids; the dev-only relaxation is `vite/dev-sideload-csp.ts`) and never for
 * `vite build` (the built bundle carries no header of its own).
 */
import type { Plugin } from 'vite';
import { buildProductionCspHeader } from '../src/security/production-csp';

/** Env var carrying a comma-separated list of trusted registry-CDN origins for the preview policy. */
export const REGISTRY_ORIGINS_ENV = 'GRIDMASON_REGISTRY_ORIGINS';

/** Split a comma/space-separated env value into a clean origin list. */
function originsFromEnv(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(/[,\s]+/)
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/**
 * The production CSP the preview server reports on. The demo preview runs the
 * default posture (no live registry, sideload `off`), so the policy is the strict
 * self-only base; a deployment mirroring a real registry can pass its CDN origins
 * via {@link REGISTRY_ORIGINS_ENV}. Acknowledged sideload origins are a runtime,
 * config-recorded concern of the deployment (not known at preview start), so they
 * are empty here — the report-only run validates the base policy the demo serves.
 */
export function previewCspHeader(): string {
  return buildProductionCspHeader({
    registryOrigins: originsFromEnv(process.env[REGISTRY_ORIGINS_ENV]),
    sideloadScriptSrc: [],
  });
}

/** The Vite plugin that delivers the production CSP as a report-only header (preview only). */
export function productionCsp(): Plugin {
  return {
    name: 'gridmason:production-csp',
    configurePreviewServer(server) {
      const header = previewCspHeader();
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Content-Security-Policy-Report-Only', header);
        next();
      });
    },
  };
}
