/**
 * Scoped widget **remount** for the dev hot-reload loop (docs/SPEC.md §4, FR-7,
 * issue #41).
 *
 * The standalone `gridmason dev` harness reacts to a source edit with a **full
 * document reload** — the only way to defeat the one-shot `customElements.define`
 * (a custom-element tag can be registered exactly once per document, so
 * re-importing a fresh entry re-runs `define` as a no-op and the *old* class stays
 * registered; cli docs/dev-server.md). The dashboard cannot reload the whole
 * document — that would tear down the entire session — so it instead **remounts
 * only the reloaded origin's widget instances** on the live canvas.
 *
 * Core's `<gm-page-canvas>` exposes no per-instance remount; its one reconciliation
 * lever is the `layout` setter, whose `#render` removes an item that has left the
 * layout (firing its `disconnectedCallback`) before mounting a fresh element for
 * one that (re)appears. So a remount is a **two synchronous assignments**: first a
 * layout with the target instances withheld (they unmount), then the original back
 * (they mount fresh, re-running `connectedCallback`). Both happen in one task, so
 * the browser never paints the intermediate state — no flicker — and every other
 * widget is a survivor that updates in place, never remounting. The fresh mount is
 * what lets a widget re-read whatever it reads on mount (the demo dev widget
 * re-fetches its `/content`), which is how a re-served change lands.
 *
 * **What this does and does not deliver.** It re-runs the widget's mount lifecycle,
 * so a change to data/content the widget reads on mount appears immediately. It
 * does **not** swap the element *class*: because a tag cannot be redefined in a
 * live document, a change to the widget's own code does not take effect in-place
 * (the standalone harness's full-page reload is the escape hatch for that). This
 * pure module is unit-tested against the layout math; the DOM double-assign is
 * exercised by the dev-sideload e2e.
 */
import type { EffectiveLayout } from '@gridmason/core/engine';
import type { LayoutGrid, LayoutPage } from '@gridmason/protocol';
import type { GmPageCanvasElement } from '../canvas/gm-page-canvas';

/** The grid-item ids (`i`) of every placed instance whose widget tag is `tag`. */
export function instanceIdsForTag(layout: LayoutPage, tag: string): readonly string[] {
  const grids = layout.hasTabs ? layout.tabs.map((tab) => tab.grid) : [layout.grid];
  const ids: string[] = [];
  for (const grid of grids) {
    for (const item of grid.items) {
      if (item.widgetID.tag === tag) ids.push(item.i);
    }
  }
  return ids;
}

/**
 * A copy of `effective` with the given instance ids removed from every grid
 * (single-grid and each tab). Pure — the input is never mutated; only the arrays
 * that actually lose an item are rebuilt.
 */
export function layoutWithoutInstances(
  effective: EffectiveLayout,
  instanceIds: ReadonlySet<string>,
): EffectiveLayout {
  const filterGrid = (grid: LayoutGrid): LayoutGrid => ({
    items: grid.items.filter((item) => !instanceIds.has(item.i)),
  });
  const layout = effective.layout;
  const nextLayout: LayoutPage = layout.hasTabs
    ? { ...layout, tabs: layout.tabs.map((tab) => ({ ...tab, grid: filterGrid(tab.grid) })) }
    : { ...layout, grid: filterGrid(layout.grid) };
  return { ...effective, layout: nextLayout };
}

/**
 * Remount every currently-mounted instance of `tag` on `canvas` by withholding
 * them from the layout and restoring it (see the module doc). A no-op if the
 * canvas has no layout yet or no instance of `tag` is mounted, so a `reload` for a
 * widget the user has not placed costs nothing.
 */
export function remountInstancesByTag(canvas: GmPageCanvasElement, tag: string): void {
  const current = canvas.layout;
  if (current === undefined) return;
  const mounted = new Set(canvas.mountedInstanceIds);
  const target = new Set(instanceIdsForTag(current.layout, tag).filter((id) => mounted.has(id)));
  if (target.size === 0) return;
  canvas.layout = layoutWithoutInstances(current, target); // unmount the targets
  canvas.layout = current; // remount them fresh — connectedCallback re-runs
}
