/**
 * The dashboard's pinned copy of `@gridmason/sdk`, re-exported for the
 * **dev-sideload import scope** (docs/SPEC.md §4, issue #40) — **dev server
 * only**.
 *
 * `gridmason dev` serves a scaffold-template widget's entry **verbatim**, so a
 * widget that does `import … from '@gridmason/sdk'` reaches the browser with that
 * bare specifier intact. The dashboard's dev-only import map (`vite/dev-sideload-
 * import-scope.ts`) points `@gridmason/sdk` at *this* module so that import
 * resolves to the dashboard's own installed SDK — the version pinned in
 * `package.json`, deduped with the app's own SDK usage.
 *
 * Why a re-export and not the raw package file: the Vite dev server transforms
 * this module on request, rewriting the `@gridmason/sdk` bare import (and, inside
 * the SDK, its own `@gridmason/protocol` import) to resolved dev-server URLs. The
 * copy the sideloaded widget ends up loading therefore carries **no** bare
 * specifiers of its own — the browser never has to resolve one it cannot. This is
 * also why the map only needs `@gridmason/sdk` and `@gridmason/protocol`: the
 * SDK's internal protocol import is handled here by Vite, not by the import map.
 *
 * This file is never statically imported by app code — it is reached only through
 * the import map's runtime URL — so a production `vite build` (which also drops
 * the serve-only injector plugin) leaves it out of the bundle entirely.
 */
export * from '@gridmason/sdk';
