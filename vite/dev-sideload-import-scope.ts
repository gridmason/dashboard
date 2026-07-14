/**
 * Dev-only import-map delivery for the sideload `@gridmason/*` scope (docs/SPEC.md
 * §4, issue #40).
 *
 * `gridmason dev` serves a scaffold-template widget's entry **verbatim**, so a
 * widget that does `import … from '@gridmason/sdk'` reaches the browser with that
 * bare specifier. When the dashboard `import()`s that entry URL the browser must
 * resolve the specifier — and with no import map it throws
 * `Failed to resolve module specifier "@gridmason/sdk"`. This plugin injects a
 * `<script type="importmap">` that maps the `@gridmason/*` specifiers to the
 * dashboard's own pinned copies (the `src/sideload/scope/*` re-export modules,
 * which Vite serves transformed — see those files), so a sideloaded module
 * resolves them against the app's SDK rather than failing.
 *
 * Honest by construction, mirroring the CSP plugin beside it:
 *
 * - `apply: 'serve'` — it runs for `vite dev` only. A production `vite build`
 *   never injects the map (and the scope modules, reached only through the map's
 *   runtime URL, are never bundled), so the production output is untouched. Dev
 *   sideload ships in development builds only (SPEC §4).
 * - It injects **only when the owner opts in** ({@link isDevSideloadGateEnabled},
 *   `GRIDMASON_DEV_SIDELOAD=1`) — the same gate as the CSP relaxation. A plain
 *   `npm run dev` gets no map at all.
 *
 * ## Shape: a top-level `imports` map, not `scopes`
 *
 * The map is a top-level `imports` block rather than being scoped to the dev-server
 * origins. That is deliberate, and safe here specifically because this is the **dev
 * server**:
 *
 * - The app's own modules never resolve a bare `@gridmason/*` specifier in the
 *   browser — Vite rewrites every one to a resolved dev URL at transform time. The
 *   **only** modules that reach the browser with a bare `@gridmason/*` specifier
 *   are the verbatim-served sideloaded ones. So a top-level mapping is consulted
 *   *only* by sideloaded modules; it cannot alter how the app loads its own SDK.
 * - Scoping to the sideload origins would need a scope key per origin, but the
 *   admitted origins are arbitrary localhost **ports** chosen at runtime (the
 *   per-session allowlist) and import-map scope keys are fixed URL prefixes with no
 *   port wildcard — so an origin-scoped map cannot cover them without being rebuilt
 *   and re-injected per registration, which the "map must precede the first
 *   resolution" rule makes fragile. A single map injected once, up front, is the
 *   robust shape.
 *
 * ## Injected up front (`head-prepend`)
 *
 * The map is prepended to `<head>`, before the app's module script, so it is
 * present before **any** module resolution begins — satisfying the browser rule
 * that an import map must precede the first import it governs (the first sideload
 * `import()` happens far later, on a picker action, but front-loading the map keeps
 * it correct under the strictest interpretation and needs no runtime injection).
 *
 * Framework specifiers (`react`, `vue`) that a React/Vue scaffold template also
 * imports are **out of scope** (issue #40) — only `@gridmason/*` is mapped; the
 * remaining limitation is documented in docs/sideload.md.
 */
import type { Plugin } from 'vite';
import { isDevSideloadGateEnabled } from './dev-sideload-csp';

/**
 * The `@gridmason/*` bare specifiers a scaffold-template widget imports, mapped to
 * the dashboard's Vite-served re-export modules (root-relative URLs, resolved
 * against the document base). Only the framework-agnostic surface is mapped —
 * `@gridmason/sdk` (root), its framework-free `/vanilla` adapter, and
 * `@gridmason/protocol`; the SDK's own internal `@gridmason/protocol` import is
 * resolved by Vite inside the re-export, not by this map.
 */
export const SIDELOAD_IMPORT_MAP: Readonly<Record<string, string>> = {
  '@gridmason/sdk': '/src/sideload/scope/sdk.ts',
  '@gridmason/sdk/vanilla': '/src/sideload/scope/sdk-vanilla.ts',
  '@gridmason/protocol': '/src/sideload/scope/protocol.ts',
};

/** The Vite plugin that injects the dev-sideload `@gridmason/*` import map (serve mode only). */
export function devSideloadImportScope(): Plugin {
  return {
    name: 'gridmason:dev-sideload-import-scope',
    apply: 'serve',
    transformIndexHtml() {
      if (!isDevSideloadGateEnabled()) return; // gate off → no map → dev experience untouched
      return [
        {
          tag: 'script',
          attrs: { type: 'importmap' },
          children: JSON.stringify({ imports: SIDELOAD_IMPORT_MAP }),
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
