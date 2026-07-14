/**
 * Local import-map assembly (docs/SPEC.md §2, FR-1/FR-2, GW-D22).
 *
 * The boot pipeline resolves a page to an {@link EffectiveLayout}, then — before
 * the canvas mounts a widget — the shell **dynamically imports** that widget's
 * entry module so its custom element is registered. Which module a widget tag
 * loads from is decided by the **import map** (GW-D22): native ESM, no
 * Module-Federation runtime.
 *
 * This is the **Phase-A** assembly: **local remotes only**. Every entry points
 * at a module bundled with the shell (a `local` source, `@gridmason/protocol`
 * identity.ts), assembled from the demo page types' default layouts. Phase B
 * (D-E3) merges the enabled registries' resolved remotes into the same map —
 * their entries carry verified CDN URLs and ride the Service-Worker fetch path —
 * and injects the merged map as a real `<script type="importmap">`. Keeping the
 * shell's view of "how a tag becomes a module" behind this one module is what
 * lets that later change be additive: the boot glue calls {@link loadWidgetTag}
 * and never learns whether a remote was local or federated.
 */

import type { LayoutPage } from '@gridmason/protocol';

/**
 * The custom-element tag of the Phase-A placeholder widget every demo layout
 * references. It is scaffolding: the first-party demo widgets (clock, markdown,
 * record-summary, chart, crasher) land in #6 and replace these entries with
 * their own tags and modules. Kept here (DOM-free) so the page-type config and
 * the widget module agree on one spelling.
 */
export const PLACEHOLDER_WIDGET_TAG = 'gm-placeholder-widget';

/** The literal `source` of a host-bundled (local) remote — mirrors protocol identity.ts. */
export const LOCAL_SOURCE = 'local';

/**
 * One local remote in the import map: the widget `tag` it registers, its
 * `source`-qualified identity, the bare `specifier` the declarative import map
 * maps, and the native dynamic `import()` that loads (and, as a side effect,
 * registers) its custom element. `load` is a thunk rather than an eager import
 * so a tag's module is fetched only on activation (SPEC §2 "lazy") — and so this
 * module stays DOM-free until a remote is actually loaded.
 */
export interface LocalRemote {
  /** The custom-element tag this remote registers. */
  readonly tag: string;
  /** Source-qualified identity — always `local` in Phase A. */
  readonly source: string;
  /** The bare specifier the declarative import map binds to a module URL. */
  readonly specifier: string;
  /** Lazily import the entry module, registering the element as a side effect. */
  readonly load: () => Promise<unknown>;
}

/** The assembled import map: local remotes keyed by widget tag. */
export type LocalImportMap = ReadonlyMap<string, LocalRemote>;

/**
 * The declarative native-ESM import map shape (`{ imports }`). Phase B injects
 * this as a `<script type="importmap">`; Phase A never needs to, because every
 * remote is a shell-bundled module reached through {@link LocalRemote.load}. It
 * is still assembled so the map is inspectable and the Phase-B injection is a
 * drop-in.
 */
export interface ImportMapJson {
  readonly imports: Readonly<Record<string, string>>;
}

/**
 * The single Phase-A local remote: the placeholder widget. Its `load` thunk is
 * where — and the only place — a DOM-touching module is imported, so importing
 * *this* module (e.g. from the page-type config, under Node in unit tests) never
 * evaluates widget code.
 */
const PLACEHOLDER_REMOTE: LocalRemote = {
  tag: PLACEHOLDER_WIDGET_TAG,
  source: LOCAL_SOURCE,
  specifier: `${LOCAL_SOURCE}/${PLACEHOLDER_WIDGET_TAG}`,
  load: () => import('../widgets/placeholder'),
};

/**
 * Assemble the Phase-A local import map. Local remotes only — no registry, no
 * sideload (those are D-E3/D-E2). The result is a fresh map each call so a
 * caller can extend it without mutating shared state.
 */
export function assembleImportMap(): LocalImportMap {
  const remotes: readonly LocalRemote[] = [PLACEHOLDER_REMOTE];
  return new Map(remotes.map((remote) => [remote.tag, remote]));
}

/**
 * The declarative `{ imports }` projection of a map — the artifact Phase B
 * injects as `<script type="importmap">`. In Phase A the mapped value is the
 * remote's bare specifier (the module is reached via {@link LocalRemote.load});
 * Phase B replaces it with the registry's verified CDN URL.
 */
export function toImportMapJson(map: LocalImportMap): ImportMapJson {
  const imports: Record<string, string> = {};
  for (const remote of map.values()) {
    imports[remote.specifier] = remote.specifier;
  }
  return { imports };
}

/**
 * Load the entry module for one widget `tag` through the import map, registering
 * its custom element. Resolves silently (no-op) for a tag the map does not carry
 * — an unmapped tag mounts as an unupgraded element rather than blocking the
 * page (SPEC §7: the shell never blocks on widget code). Idempotent: the entry
 * module guards its own `customElements.define`, so repeated activations of the
 * same tag are safe.
 */
export async function loadWidgetTag(map: LocalImportMap, tag: string): Promise<void> {
  const remote = map.get(tag);
  if (remote === undefined) return;
  await remote.load();
}

/**
 * Load every distinct widget module a resolved layout references — the "route/
 * slot activation dynamically imports the widget's entry module" step of the
 * boot pipeline (SPEC §2), run once per page render across both single-grid and
 * tabbed layouts. Failures are isolated per tag: one remote that fails to load
 * never prevents the others (or the canvas) from rendering.
 */
export async function loadWidgetsForLayout(
  map: LocalImportMap,
  layout: LayoutPage,
): Promise<void> {
  const tags = new Set<string>();
  const grids = layout.hasTabs ? layout.tabs.map((tab) => tab.grid) : [layout.grid];
  for (const grid of grids) {
    for (const item of grid.items) {
      tags.add(item.widgetID.tag);
    }
  }
  await Promise.allSettled([...tags].map((tag) => loadWidgetTag(map, tag)));
}
