/**
 * The client-side **sideload posture** (docs/SPEC.md §4, FR-8, FR-16) — the single
 * place the browser decides whether a sideloaded remote is allowed into the import
 * map at all. `off` is the default, and off means off: no remote is admitted, so
 * none enters the import map and none can mount.
 *
 * SPEC §4 gives sideload three host-configurable modes: `off` (registry-signed
 * remotes only — the default), `dev` (local dev-server remotes, per session), and
 * `acknowledged` (persistent, owner-acknowledged remotes registered by URL). This
 * module resolves the deploy's posture from a build-time define and answers the one
 * question the render path needs — *may this class of sideloaded remote load?* —
 * with a hard-off default.
 *
 * ## Two independent enforcement points, both default-off
 *
 * The posture is enforced on the client at **two** layers that must agree for a
 * remote to run:
 *
 * - **Import-map admission (this module).** Whether the `acknowledged` provider
 *   resolves and installs its remotes into the import map. Governed by
 *   {@link resolveSideloadMode} (`off` unless the deploy sets `acknowledged`).
 * - **`script-src` (server, `server/config`).** Which acknowledged origins the
 *   deployment's CSP permits — the config-recorded authority, also default-off.
 *
 * Both being off by default is the invariant #13 locks: with no mode set, neither
 * layer admits anything, and the production CSP is never relaxed.
 *
 * ## Why `dev` is not gated here
 *
 * The `dev` posture has its **own**, already-off-by-default gate that is stricter
 * than a config flag: it exists only in a development build (`import.meta.env.DEV`),
 * its CSP relaxation is delivered only when the dev server is started with
 * `GRIDMASON_DEV_SIDELOAD` (`vite/dev-sideload-csp.ts`), and a remote is admitted
 * only after an explicit in-session owner acknowledgement. A production build drops
 * the whole dev subtree (`production-gate.test.ts`). So this module governs the
 * `acknowledged` posture — the one that is prod-safe and therefore needs an explicit
 * off default here — and reports `dev` for completeness.
 */

/** The host-configurable sideload posture (SPEC §4). `off` is the default. */
export type SideloadMode = 'off' | 'dev' | 'acknowledged';

/** The default posture: registry-signed remotes only, nothing sideloaded (SPEC §4). */
export const DEFAULT_SIDELOAD_MODE: SideloadMode = 'off';

/**
 * The Phase-A honesty caveat, **verbatim** (FR-8). This is the single source of the
 * exact string every surface must show an operator who enables a sideload mode — the
 * docs page and the in-app acknowledgement copy both render it from here so they can
 * never drift. Phase A ships hash-pinning but no signed, logged verification chain,
 * so the only real safeguard is the operator's own review.
 */
export const SIDELOAD_NO_VERIFY_CAVEAT =
  'no verify chain yet — run only widgets you built or reviewed yourself';

/** The three valid postures, for validating an untrusted config value. */
const VALID_MODES: readonly SideloadMode[] = ['off', 'dev', 'acknowledged'];

/**
 * Read the raw posture the build was configured with. `__GM_SIDELOAD_MODE__` is a
 * Vite `define` (see `vite.config.ts`) sourced from `GRIDMASON_SIDELOAD_MODE` at
 * build/serve time; it is absent under Vitest (no define) and in any context that
 * did not set it, which is exactly when the default must apply. Read through a
 * `typeof` guard so an undefined global is `undefined`, never a `ReferenceError`.
 */
function rawConfiguredMode(): unknown {
  return typeof __GM_SIDELOAD_MODE__ !== 'undefined' ? __GM_SIDELOAD_MODE__ : undefined;
}

/**
 * The deploy's sideload posture, defaulting to {@link DEFAULT_SIDELOAD_MODE}. Any
 * value that is not one of the three known modes (unset, misspelled, tampered) is
 * treated as `off` — an unrecognized posture must never be *more* permissive than
 * the default. Pass an explicit `raw` to resolve a value in a test.
 */
export function resolveSideloadMode(raw: unknown = rawConfiguredMode()): SideloadMode {
  return VALID_MODES.includes(raw as SideloadMode) ? (raw as SideloadMode) : DEFAULT_SIDELOAD_MODE;
}

/**
 * Whether **acknowledged** sideload remotes may be admitted into the import map.
 * `true` only when the deploy's posture is explicitly `acknowledged`; `off` and
 * `dev` both return `false`, so a persistent registration never loads unless the
 * owner turned acknowledged mode on (SPEC §4, FR-16).
 */
export function acknowledgedSideloadEnabled(mode: SideloadMode = resolveSideloadMode()): boolean {
  return mode === 'acknowledged';
}
