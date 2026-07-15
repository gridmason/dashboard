/**
 * Boot step 3 — **import-map assembly** (docs/SPEC.md §2, FR-10; GW-D22;
 * gridmason/registry `docs/api/resolution.md`).
 *
 * ```
 * boot → gate snapshot (../boot/gate-snapshot)
 *   → registry resolution API (../boot/resolution-client)
 *   → import map assembled (local remotes + enabled registry remotes)  ← this module
 *   → lazy verified import()  (#16)
 * ```
 *
 * Merges the Phase-A **local** import map (`../boot/import-map`, shell-bundled
 * remotes) with one or more registry {@link ImportMapFragment}s into **one** valid
 * native-ESM import map (`imports` + `scopes`) — no Module-Federation runtime, no
 * globals (GW-D22). Loading is native ESM: the browser resolves a widget's bare
 * specifier through this one map.
 *
 * Three things happen here:
 *
 * 1. **Absolute URLs.** A fragment's URLs are **root-relative** to its registry's
 *    serving surface (`/v1/artifacts/<hash>`, #12). The host pins each registry to a
 *    serving origin and composes absolute URLs by prepending it — done here — so a
 *    merged map that draws from several registries addresses each remote's real
 *    origin (and the Service Worker verifies by exact URL, #19).
 *
 * 2. **Shared-dependency `scopes` (GW-D22).** The registry already picked each
 *    widget's shared major against the shell's offer and emitted `scopes` keyed by
 *    the widget's entry URL — only for a widget needing a **non-default** major
 *    (never a global override). This step carries those scopes through, rekeyed to
 *    the module's **absolute** entry URL so they match the importer the browser
 *    sees. Widgets that agree on the default share one instance and produce no
 *    scope.
 *
 * 3. **Prefix-pin conflict = config error.** Publisher prefixes are unique only
 *    *within* a registry, so a host merging several sources pins each specifier to
 *    one target. Two sources that map the **same specifier to different targets** is
 *    the host's **configuration error** to reject ({@link PrefixPinConflictError}) —
 *    never silently resolved to one of them (registry SPEC §9). Identical pins are
 *    idempotent and merge cleanly.
 *
 * **Carries bundles through untouched.** Each assembled module keeps its
 * {@link SignatureBundle} by reference — verification is the lazy-mount step (#16),
 * not this one. Nothing here is trusted for having been assembled.
 *
 * **v0 reload on gate change.** The assembled map is injected once per page load
 * (as `<script type="importmap">`; a live import map cannot be mutated after the
 * first module resolves). Re-running the gate → resolve → assemble pipeline after a
 * **gate change** therefore takes effect only on a **full reload**: v0 requires a
 * reload after a gate change, and dynamic re-assembly of a live map is out of scope
 * (issue #15 risk note). A disabled remote is dropped at the gate snapshot before it
 * ever reaches this map (SPEC §2 "gate = kill switch").
 */
import type { ExcludedModule, ImportMapFragment, ResolvedModule } from '@gridmason/protocol';
import type { ImportMapJson } from './import-map';

/**
 * One registry fragment plus the **serving origin** the host has pinned it to. The
 * fragment's root-relative URLs are composed against this origin into absolute URLs
 * (the resolution surface that produced the fragment and the serving surface #12 may
 * be different origins, so the pin is supplied here, not read from the fragment).
 */
export interface ResolvedRegistry {
  /** The import-map fragment returned by `POST /v1/resolve`. */
  readonly fragment: ImportMapFragment;
  /**
   * The absolute serving origin this registry's artifacts are pinned to
   * (e.g. `https://cdn.gridmason.dev`). Root-relative fragment URLs are prefixed
   * with it to form the absolute URLs the import map and Service Worker use.
   */
  readonly servingOrigin: string;
}

/**
 * One resolved remote in the assembled map: the source-qualified identity and the
 * absolute, hash-pinned entry URL its specifier maps to, carrying its
 * {@link ResolvedModule.bundle} through untouched for the verified-mount step (#16).
 */
export type AssembledModule = ResolvedModule;

/**
 * The assembled federated import map: the merged declarative `{ imports, scopes }`
 * (local remotes + enabled registry remotes, absolute-URL, GW-D22), the resolved
 * `modules` carrying their signature bundles (for #16's verified mount), and the
 * `excluded` remotes carried through for the SPEC §6/§8 fallback cards.
 */
export interface AssembledImportMap {
  /** Bare specifier → module URL (local specifiers as-is; registry URLs absolute). */
  readonly imports: Readonly<Record<string, string>>;
  /** Import-map `scopes`, keyed by absolute entry URL → shared specifier → offer URL. */
  readonly scopes: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Resolved registry modules with absolute URLs, carrying their bundles by reference. */
  readonly modules: readonly AssembledModule[];
  /** Requested modules that did not resolve, for fallback cards (never in `imports`). */
  readonly excluded: readonly ExcludedModule[];
}

/**
 * Thrown when two sources map the **same import specifier to different targets** —
 * the host's configuration error to reject rather than silently pick one (registry
 * SPEC §9, FR-10). Carries the specifier and both conflicting targets.
 */
export class PrefixPinConflictError extends Error {
  override readonly name = 'PrefixPinConflictError';
  constructor(
    readonly specifier: string,
    readonly existing: string,
    readonly incoming: string,
  ) {
    super(
      `import-map prefix-pin conflict: "${specifier}" is pinned to "${existing}" and "${incoming}" — ` +
        'a merged map may pin each specifier to only one target (registry SPEC §9)',
    );
  }
}

/**
 * Assemble one federated import map from the local map and the resolved registry
 * fragments. Local imports seed the map; each fragment's imports/scopes are rebased
 * onto its serving origin and merged. A specifier pinned to two different targets
 * throws {@link PrefixPinConflictError}; identical pins are idempotent. With no
 * fragments this is just the local map (Phase-A behaviour), so the same call serves
 * a deployment with nothing federated enabled.
 */
export function assembleFederatedImportMap(
  local: ImportMapJson,
  registries: readonly ResolvedRegistry[] = [],
): AssembledImportMap {
  const imports: Record<string, string> = {};
  const scopes: Record<string, Record<string, string>> = {};
  const modules: AssembledModule[] = [];
  const excluded: ExcludedModule[] = [];

  // Local remotes seed the map (shell-bundled specifiers, no rebasing).
  for (const [specifier, target] of Object.entries(local.imports)) {
    pin(imports, specifier, target);
  }

  for (const { fragment, servingOrigin } of registries) {
    // imports: rebase each root-relative URL onto the pinned serving origin.
    for (const [specifier, url] of Object.entries(fragment.imports)) {
      pin(imports, specifier, absolute(servingOrigin, url));
    }

    // scopes: rekey to the absolute entry URL so the scope matches the importer the
    // browser sees; values are the shell's own offer URLs, carried through as-is.
    for (const [entryUrl, mapping] of Object.entries(fragment.scopes)) {
      const key = absolute(servingOrigin, entryUrl);
      const scope = (scopes[key] ??= {});
      for (const [shared, offerUrl] of Object.entries(mapping)) {
        pin(scope, shared, offerUrl);
      }
    }

    // modules: absolute entry URL, bundle carried through untouched by reference.
    for (const module of fragment.modules) {
      modules.push({ ...module, url: absolute(servingOrigin, module.url) });
    }

    excluded.push(...fragment.excluded);
  }

  return { imports, scopes, modules, excluded };
}

/**
 * Pin `specifier` to `target` in `into`, or throw {@link PrefixPinConflictError} if
 * it is already pinned to a different target. An identical repeat pin is a no-op.
 */
function pin(into: Record<string, string>, specifier: string, target: string): void {
  const existing = into[specifier];
  if (existing !== undefined && existing !== target) {
    throw new PrefixPinConflictError(specifier, existing, target);
  }
  into[specifier] = target;
}

/**
 * Compose an absolute URL from a pinned serving origin and a fragment's
 * root-relative path. String join (not `new URL`) so a `sha2-256:<hex>` segment's
 * colon is preserved verbatim and a serving origin carrying a base path is kept.
 */
function absolute(servingOrigin: string, path: string): string {
  const base = servingOrigin.replace(/\/+$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}
