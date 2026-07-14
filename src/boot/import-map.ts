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
 * identity.ts) — the five first-party demo widgets (clock, markdown,
 * record-summary, chart, crasher) that exercise the whole widget ABI (SPEC §5).
 * Phase B (D-E3) merges the enabled registries' resolved remotes into the same
 * map — their entries carry verified CDN URLs and ride the Service-Worker fetch
 * path — and injects the merged map as a real `<script type="importmap">`.
 * Keeping the shell's view of "how a tag becomes a module" behind this one module
 * is what lets that later change be additive: the boot glue calls
 * {@link loadWidgetTag} and never learns whether a remote was local or federated.
 */

import { LOCAL_SOURCE } from '@gridmason/protocol';
import type { LayoutPage, WidgetID } from '@gridmason/protocol';

export { LOCAL_SOURCE };

/**
 * The custom-element tags of the five first-party demo widgets (SPEC §5). Declared
 * here — DOM-free — so the page-type config, this map, and each widget module
 * agree on one spelling **without** this module statically importing widget code:
 * a widget imports its own tag from here, and the map reaches the widget only
 * through a lazy `import()` thunk (below). That keeps import-map DOM-free and lets
 * each widget code-split into its own chunk (SPEC §2 "lazy activation").
 */
export const WIDGET_TAGS = {
  clock: 'gm-clock-widget',
  markdown: 'gm-markdown-widget',
  recordSummary: 'gm-record-summary-widget',
  chart: 'gm-chart-widget',
  crasher: 'gm-crasher-widget',
} as const;

/**
 * One local remote in the import map: the widget `tag` it registers, its
 * `source`-qualified identity, a human `name` (for the error-boundary fallback
 * card), the bare `specifier` the declarative import map maps, and the native
 * dynamic `import()` that loads (and, as a side effect, registers) its custom
 * element. `load` is a thunk rather than an eager import so a tag's module is
 * fetched only on activation (SPEC §2 "lazy") — and so this module stays DOM-free
 * until a remote is actually loaded.
 */
export interface LocalRemote {
  /** The custom-element tag this remote registers. */
  readonly tag: string;
  /** Source-qualified identity — always `local` in Phase A. */
  readonly source: string;
  /** Human display name, shown on the boundary fallback card (SPEC §6/§8). */
  readonly name: string;
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

/** Build a local remote for `tag`, deriving its `local`-qualified specifier. */
function localRemote(tag: string, name: string, load: () => Promise<unknown>): LocalRemote {
  return { tag, source: LOCAL_SOURCE, name, specifier: `${LOCAL_SOURCE}/${tag}`, load };
}

/**
 * The Phase-A local remotes: the five first-party demo widgets. Each `load` thunk
 * is where — and the only place — a DOM-touching widget module is imported, so
 * importing *this* module (e.g. from the page-type config, under Node in unit
 * tests) never evaluates widget code.
 */
const LOCAL_REMOTES: readonly LocalRemote[] = [
  localRemote(WIDGET_TAGS.clock, 'Clock', () => import('../widgets/clock/clock')),
  localRemote(WIDGET_TAGS.markdown, 'Notes', () => import('../widgets/markdown/markdown')),
  localRemote(WIDGET_TAGS.recordSummary, 'Record summary', () => import('../widgets/record-summary/record-summary')),
  localRemote(WIDGET_TAGS.chart, 'Chart', () => import('../widgets/chart/chart')),
  localRemote(WIDGET_TAGS.crasher, 'Crasher', () => import('../widgets/crasher/crasher')),
];

/** Widget tag → display name, for the boundary descriptor (built once from the remotes). */
const WIDGET_NAMES: ReadonlyMap<string, string> = new Map(
  LOCAL_REMOTES.map((remote) => [remote.tag, remote.name]),
);

/**
 * Resolve a display **name** for a widget instance's fallback card (SPEC §6/§8) —
 * the shape core's `PageCanvas.widgetDescriptor` expects. A first-party (`local`)
 * tag resolves to its friendly name; any other identity returns `undefined`, so
 * an unknown/unentitled widget stays an anonymous card (no tag/name echo). Wired
 * onto the canvas in `CanvasHost`.
 */
export function describeWidget(identity: { readonly widgetID: WidgetID }): string | undefined {
  if (identity.widgetID.source !== LOCAL_SOURCE) return undefined;
  return WIDGET_NAMES.get(identity.widgetID.tag);
}

/**
 * Assemble the Phase-A local import map. Local remotes only — no registry, no
 * sideload (those are D-E3/D-E2). The result is a fresh map each call so a
 * caller can extend it without mutating shared state.
 */
export function assembleImportMap(): LocalImportMap {
  return new Map(LOCAL_REMOTES.map((remote) => [remote.tag, remote]));
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
