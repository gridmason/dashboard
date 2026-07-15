/**
 * Build-time support for the **static-demo** (serverless / GitHub Pages) target
 * (issue #78). Active only when `GRIDMASON_STATIC_DEMO=1` — i.e. under
 * `npm run build:static-demo` — and inert for every other build/serve, so a normal
 * `vite build` is unchanged.
 *
 * A static host (GitHub Pages) cannot send response headers, so it can serve
 * neither the enforced production CSP (`docker/nginx.conf`) nor an SPA rewrite.
 * This plugin covers both from the build output:
 *
 * - **Meta CSP.** Injects the enforced production Content-Security-Policy as a
 *   `<meta http-equiv="Content-Security-Policy">`, built from the single source of
 *   truth ({@link buildProductionCspHeader}), **minus `frame-ancestors`** — browsers
 *   ignore `frame-ancestors` in a `<meta>` tag (docs/csp.md). That one directive is
 *   the documented delta versus the header-served policy; a static host that cannot
 *   set headers cannot express the no-framing guarantee, so it is called out in the
 *   README and docs/csp.md rather than silently dropped.
 * - **SPA fallback.** Copies the built `index.html` to `404.html` so a deep link
 *   (e.g. `/demo/p/demo.locked` refreshed directly) is served the app shell by
 *   Pages' 404 handler instead of a hard 404 — the static-host analog of
 *   nginx's `try_files … /index.html`.
 */
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { buildProductionCspHeader } from '../src/security/production-csp';

/** The env flag that turns the static-demo target on. */
export const STATIC_DEMO_ENV = 'GRIDMASON_STATIC_DEMO';

/** Whether the current build is the static-demo target. */
export function isStaticDemoBuild(): boolean {
  return process.env[STATIC_DEMO_ENV] === '1';
}

/**
 * The enforced production CSP as a `<meta>` value: the strict self-only policy
 * (no federation, sideload off) minus `frame-ancestors`, which a `<meta>` CSP
 * cannot express. Everything else is identical to the header in `docker/nginx.conf`.
 */
export function staticDemoMetaCsp(): string {
  return buildProductionCspHeader({ registryOrigins: [], sideloadScriptSrc: [] })
    .split('; ')
    .filter((directive) => !directive.startsWith('frame-ancestors'))
    .join('; ');
}

/** The static-demo build plugin (meta CSP + SPA 404 fallback). No-op unless {@link isStaticDemoBuild}. */
export function staticDemo(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'gridmason:static-demo',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    transformIndexHtml(html) {
      if (!isStaticDemoBuild()) return html;
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: staticDemoMetaCsp(),
            },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
    closeBundle() {
      if (!isStaticDemoBuild()) return;
      // SPA fallback for a header-less static host (Pages serves 404.html for any
      // unknown path): make it the app shell so client-routed deep links resolve.
      const outDir = resolve(config.root, config.build.outDir);
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
    },
  };
}
