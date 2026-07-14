/**
 * Sideload identity helpers (docs/SPEC.md §4, GW-D7) — the small, **prod-safe**
 * slice of the sideload feature.
 *
 * A dev-sideloaded widget carries a `sideload:<origin>` source-qualified identity
 * (`@gridmason/protocol` identity.ts, {@link SIDELOAD_PREFIX}) — exactly like a
 * registry widget carries a registry-id source. These pure functions map between
 * a dev-server `origin` and that identity, and answer "is this instance
 * sideloaded?" for the badge + descriptor path.
 *
 * This module deliberately holds **no** allowlist, dev-server, or CSP logic and
 * no dev-only strings: it is imported by the canvas render path (`CanvasHost`,
 * behind an `import.meta.env.DEV` guard) to decorate a sideloaded card, so it
 * must stay a mechanical, side-effect-free identity mapper. The mode gate, the
 * per-session allowlist, and the CSP relaxation live in the dev-only modules
 * beside it (all reached only under `import.meta.env.DEV`, so a production build
 * drops the whole subtree — see `./index` and `production-gate.test.ts`).
 */
import { SIDELOAD_PREFIX, sourceKind, type WidgetID } from '@gridmason/protocol';

/** The distinct UI label a sideloaded widget is marked with (mockups 01 + 03). */
export const SIDELOAD_BADGE_LABEL = 'sideload';

/** The `source` string for a widget served from dev-server `origin` (`sideload:<origin>`). */
export function sideloadSource(origin: string): string {
  return `${SIDELOAD_PREFIX}${origin}`;
}

/**
 * Whether a widget identity is sideloaded (its `source` is a `sideload:<origin>`).
 * Total — a malformed source is simply "not sideloaded", never a throw, so the
 * render path can call it on any placed instance's identity.
 */
export function isSideloadedId(id: WidgetID): boolean {
  try {
    return sourceKind(id.source) === 'sideload';
  } catch {
    return false;
  }
}
