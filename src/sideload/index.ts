/**
 * Dev-sideload feature barrel (docs/SPEC.md §4, FR-7) — **development builds
 * only**.
 *
 * Everything re-exported here is reached only under `import.meta.env.DEV`: `App`
 * wraps the router with {@link DevSideloadProvider} and `AppShell` renders
 * {@link DevSideloadControls} only in a dev build, so a production build's static
 * `import.meta.env.DEV === false` makes those references dead code and drops this
 * whole subtree from the bundle (proven by `production-gate.test.ts`). The
 * prod-safe slivers the canvas render path needs — the identity helpers
 * (`./source`) and the seam (`./host-seam`) — are imported directly where used,
 * not through this dev barrel.
 */
export { DevSideloadProvider, useDevSideload } from './DevSideloadContext';
export type { DevSideloadSession } from './DevSideloadContext';
export { DevSideloadControls } from './DevSideloadControls';
