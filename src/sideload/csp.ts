/**
 * Sideload CSP policy (docs/SPEC.md §3 + §4, GW-D7) — the **single source of
 * truth** for the one CSP relaxation dev sideload is allowed to make.
 *
 * SPEC §4: the `dev` build adds the localhost dev-server origin to `script-src`
 * **only while the dev gate is on**; the **production CSP is never silently
 * relaxed**. This module encodes exactly that invariant as a pure function, so
 * it can be proven without a browser and so every delivery channel computes the
 * same policy:
 *
 * - {@link sideloadScriptSrcAdditions} is the load-bearing invariant — it returns
 *   the sources appended to `script-src`, and returns **nothing** unless the
 *   build is a dev build *and* the owner has unlocked the dev gate. A production
 *   build (`dev: false`) yields `[]` no matter what origins are passed.
 * - {@link buildDevCspHeader} composes the full dev-server policy header from a
 *   permissive dev baseline plus those additions. It is delivered **only** by the
 *   dev-only Vite plugin (`vite/dev-sideload-csp.ts`, `apply: 'serve'`), so it
 *   never reaches the production image (nginx serves the built bundle, which
 *   carries no CSP relaxation — an enforced production CSP is the separate M3
 *   hardening, SPEC §7/§9).
 *
 * The delivery split is deliberate: CSP is enforced by the browser from a
 * parse-time or header-delivered policy, whereas the per-session allowlist is
 * client-side session state (nothing persisted). So the CSP layer permits the
 * **class** of dev origins (localhost) in a dev build with the gate on, and the
 * dashboard's session allowlist decides which specific origin it will actually
 * import from — two independent gates, both dev-only.
 */

/** The inputs that decide whether — and what — sideload adds to `script-src`. */
export interface SideloadCspInputs {
  /** Whether this is a development build (`import.meta.env.DEV`). Production is always `false`. */
  readonly dev: boolean;
  /** Whether the deploying owner has unlocked the dev gate (acknowledged the risk). */
  readonly devSideloadEnabled: boolean;
  /** The dev-server origins to permit in `script-src` (e.g. `http://localhost:*`). */
  readonly origins: readonly string[];
}

/**
 * The sources dev sideload appends to `script-src`. **Empty** unless the build is
 * a dev build **and** the dev gate is on — a production build never relaxes the
 * policy (SPEC §4). Origins are trimmed, de-duplicated, and blanks dropped so the
 * result is a clean source list. This is the invariant the whole feature rests
 * on; {@link buildDevCspHeader} and the tests both go through it.
 */
export function sideloadScriptSrcAdditions(inputs: SideloadCspInputs): readonly string[] {
  if (!inputs.dev || !inputs.devSideloadEnabled) return [];
  const seen = new Set<string>();
  for (const origin of inputs.origins) {
    const trimmed = origin.trim();
    if (trimmed !== '') seen.add(trimmed);
  }
  return [...seen];
}

/**
 * The permissive dev baseline every directive builds on. It grants what the Vite
 * dev server + React Fast Refresh need (inline/eval scripts, the HMR websocket,
 * inline styles, blob workers) — acceptable precisely because it is **dev only**;
 * the production image ships no such policy. `script-src`/`connect-src` are
 * completed with the sideload additions below.
 */
const DEV_BASE_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
};

/** Serialize a directive map to a CSP header value (`name a b; name2 c`). */
function serializeDirectives(directives: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * The full `Content-Security-Policy` value the **dev server** delivers. Composes
 * the {@link DEV_BASE_DIRECTIVES} baseline with the sideload `script-src`
 * additions (and mirrors them onto `connect-src` so the dashboard can fetch the
 * dev remote's manifest from the same origin). When the gate is off — or in a
 * production build, where this is never called — `script-src`/`connect-src` carry
 * only their dev baselines and no dev-server origin appears.
 */
export function buildDevCspHeader(inputs: SideloadCspInputs): string {
  const additions = sideloadScriptSrcAdditions(inputs);
  return serializeDirectives({
    ...DEV_BASE_DIRECTIVES,
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...additions],
    'connect-src': ["'self'", 'ws:', 'wss:', ...additions],
  });
}
