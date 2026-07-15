/**
 * The **production** Content-Security-Policy (docs/SPEC.md §3 + §4, FR-13) — the
 * single source of truth for the enforced policy a deployed dashboard serves.
 *
 * SPEC §3 fixes the two load-bearing directives:
 *
 * - `script-src` = the **shell** (`'self'`) + **trusted registry-CDN origins**
 *   (the hash-addressed serving origins the verifying Service Worker loads
 *   verified remote modules from) + any **config-recorded acknowledged sideload
 *   origins** an owner explicitly added (SPEC §4). No `'unsafe-inline'` / no
 *   `'unsafe-eval'` — a production build ships no inline or eval'd script (the
 *   dev-only relaxation lives in `src/sideload/csp.ts` and never reaches here).
 * - `connect-src` = the **API origin** (`'self'` — the SPA and its host API are
 *   same-origin, SPEC §6) + the registry origins the SW reads signed release
 *   documents and inclusion proofs from on the hot path. It carries **no
 *   third-party host**: a `net:<host>` widget cannot open a browser connection to
 *   its host directly — that call is proxied through the same-origin scoped-fetch
 *   endpoint (`server/scoped-fetch`), which re-checks the declared allowlist
 *   server-side. This builder has **no knob** for a net host, so no widget
 *   capability can ever widen `connect-src` (SPEC §3, §4).
 *
 * Every other directive is locked to the minimum the app needs: no plugins
 * (`object-src 'none'`), no base-tag hijack (`base-uri 'self'`), and — honoring
 * the no-iframes principle (SPEC §3) — the app is neither framed nor frames
 * anything (`frame-ancestors 'none'`, `frame-src 'none'`).
 *
 * Pure and isomorphic (only `Object`/`Array` — no I/O, no DOM): the vite preview
 * plugin delivers it as a `Content-Security-Policy-Report-Only` header for the
 * report-only validation run, the production image serves the enforced header
 * (`docker/nginx.conf`), and a static host can render it as a `<meta>` tag — all
 * from this one function so no channel drifts (mirrors the dev SSOT in
 * `src/sideload/csp.ts`).
 */

/** The deployment inputs that parameterize the production policy. */
export interface ProductionCspInputs {
  /**
   * Trusted registry-CDN origins (the hash-addressed serving origins, e.g.
   * `https://cdn.gridmason.dev`). Added to **both** `script-src` (verified remote
   * modules execute from here) and `connect-src` (the SW reads that registry's
   * signed release documents + inclusion proofs from here on the hot path).
   * Empty for a deployment with no federated registry (the demo default).
   */
  readonly registryOrigins: readonly string[];
  /**
   * Registry origins that are **fetched but never execute script** — a resolution
   * API or revocation feed hosted on a different origin than the serving CDN.
   * `connect-src` only; never `script-src`. Optional (often the same origin as
   * {@link registryOrigins}, in which case it is omitted).
   */
  readonly connectOrigins?: readonly string[];
  /**
   * The config-recorded **acknowledged sideload** origins to add to `script-src`
   * (SPEC §4) — the output of the server's `acknowledgedScriptSrc(mode, …)`, which
   * is **empty** unless the deployment's sideload posture is explicitly
   * `acknowledged`. Each origin here is one an owner added by explicit action, so
   * every sideload origin in `script-src` is visible in the deployment's config.
   * `connect-src` is deliberately **not** widened for these — a sideloaded
   * widget's own network I/O still flows through the scoped-fetch proxy.
   */
  readonly sideloadScriptSrc: readonly string[];
}

/**
 * The directive order the policy is serialized in — fixed so the header string is
 * stable (tests pin it, and `docker/nginx.conf` mirrors the default output).
 */
const DIRECTIVE_ORDER = [
  'default-src',
  'script-src',
  'connect-src',
  'style-src',
  'img-src',
  'font-src',
  'worker-src',
  'manifest-src',
  'object-src',
  'base-uri',
  'frame-ancestors',
  'frame-src',
  'form-action',
] as const;

/** Trim, drop blanks, and de-duplicate an origin list while preserving order. */
function cleanOrigins(origins: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const origin of origins) {
    const trimmed = origin.trim();
    if (trimmed !== '') seen.add(trimmed);
  }
  return [...seen];
}

/**
 * Build the production CSP as an ordered directive map (name → source list). The
 * `script-src`/`connect-src` compositions are the SPEC §3 policy; the rest are the
 * locked-down minimum. Returned as a map so a caller can assert a single directive
 * without re-parsing the header string.
 */
export function buildProductionCspDirectives(
  inputs: ProductionCspInputs,
): Record<(typeof DIRECTIVE_ORDER)[number], readonly string[]> {
  const registry = cleanOrigins(inputs.registryOrigins);
  const connectExtra = cleanOrigins(inputs.connectOrigins ?? []);
  const sideload = cleanOrigins(inputs.sideloadScriptSrc);

  return {
    'default-src': ["'self'"],
    // Shell + trusted registry-CDN origins + explicitly-acknowledged sideload
    // origins. No 'unsafe-inline' / 'unsafe-eval': production ships neither.
    'script-src': ["'self'", ...registry, ...sideload],
    // API (same-origin 'self') + registry origins the SW reads signed content
    // from. No third-party net host — those are proxied (SPEC §3).
    'connect-src': ["'self'", ...registry, ...connectExtra],
    // Inline style *attributes* are set at runtime by the grid engine and React,
    // so style-src must permit them; scripts never get this latitude.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    // The verifying Service Worker is a same-origin module worker.
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    // No-iframes (SPEC §3): the app is neither embedded nor embeds anything.
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],
    'form-action': ["'self'"],
  };
}

/** Serialize the production CSP to a single header value (`name a b; name2 c`). */
export function buildProductionCspHeader(inputs: ProductionCspInputs): string {
  const directives = buildProductionCspDirectives(inputs);
  return DIRECTIVE_ORDER.map((name) => `${name} ${directives[name].join(' ')}`).join('; ');
}
