import { useEffect, useRef } from 'react';
import {
  PageCanvas,
  CANVAS_RENDERED_EVENT,
  CANVAS_WIDGET_MOUNTED_EVENT,
  assignSdkHandle,
  type CanvasRenderedDetail,
  type CanvasWidgetLifecycleDetail,
} from '@gridmason/core/canvas';
import { resolveLayout } from '@gridmason/core/engine';
import type { LayoutPage, WidgetID } from '@gridmason/protocol';
import 'gridstack/dist/gridstack.css';
import './canvas-host.css';

import type { PageRef } from '../routes';
import type { GmPageCanvasElement } from './gm-page-canvas';
import { resolvePageType } from '../pages/page-types';
import { buildPageContext } from '../pages/context';
import { assembleImportMap, describeWidget, loadWidgetsForLayout } from '../boot/import-map';
import { InterimHandleRegistry, toPageContext, demoHostData } from '../host-sdk';

// Register `<gm-page-canvas>` once, at module load. In core 0.3.0 importing the
// canvas module no longer defines the element as a side effect — `define()` is
// explicit and idempotent, so a host calls it freely (SPEC §2).
PageCanvas.define();

/** Canonical accessible name for the page canvas (mockup 01-canvas.html). */
export const CANVAS_LABEL = 'Page canvas — grid of widgets';

/** The local import map is assembled once — Phase A has no gate/registry inputs to vary it. */
const importMap = assembleImportMap();

/**
 * Index a resolved layout's placed items by their instance id (grid-item `i`) to
 * the widget identity mounted there, across both single-grid and tabbed layouts
 * — so the mount glue can name the `(source, tag)` a given mounted instance is,
 * when minting that mount's per-instance SDK handle.
 */
function indexWidgetIds(layout: LayoutPage): ReadonlyMap<string, WidgetID> {
  const byInstance = new Map<string, WidgetID>();
  const grids = layout.hasTabs ? layout.tabs.map((tab) => tab.grid) : [layout.grid];
  for (const grid of grids) {
    for (const item of grid.items) byInstance.set(item.i, item.widgetID);
  }
  return byInstance;
}

/**
 * The one and only page renderer (FR-1). Every route mounts this; it holds no
 * page-type-specific logic. Keeping this the sole render path is the "no
 * special-case pages" invariant later epics build page types on.
 *
 * It runs the Phase-A boot pipeline (SPEC §2) for the resolved {@link PageRef}:
 * resolve the page type → compose its default layout into an `EffectiveLayout`
 * (with the page type's locked slots) → lazily `import()` the referenced widget
 * modules from the local import map (registering their elements) → hand the
 * layout and typed context to core's `<gm-page-canvas>` through a ref. The
 * canvas is driven by properties, so the imperative ref is the seam, not JSX.
 *
 * SPEC §2 mounts each widget "with context + saved props + **SDK handle**"; this
 * is where the **interim** handle is wired (FR-9, Phase A). Core 0.3.0's canvas
 * exposes a *single* shared `sdk` property applied to every mount, so a
 * per-instance handle cannot be handed in at mount through the canvas; instead
 * the host mints one interim handle per placed instance (distinct identity,
 * fixture/no-op-backed — see `../host-sdk`) and assigns it onto each mounted
 * widget element as the canvas reports its renders (`gm:rendered` / lazy
 * `gm:widget-mounted`). The handle therefore lands immediately **after** a mount
 * rather than at it, so a context consumer must read `element.sdk` at data-read
 * time (its first render/effect), not synchronously in `connectedCallback` — the
 * late-assignment the handle-delivery contract allows (gridmason/core#52). The
 * Phase-B enforcing handle (D-E4) swaps the backing behind this same seam; the
 * widget ABI is unchanged either way.
 */
export function CanvasHost({ page }: { page: PageRef }): React.JSX.Element {
  const ref = useRef<GmPageCanvasElement>(null);
  // One interim-handle registry per canvas host: it owns this page's per-instance
  // handles and their stable identities across re-renders (`../host-sdk/registry`).
  const registryRef = useRef<InterimHandleRegistry>(null);
  registryRef.current ??= new InterimHandleRegistry();

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const registry = registryRef.current!;
    // New page = all-new instances: drop the previous page's handles so a reused
    // grid-item id mints a fresh identity rather than inheriting the old one.
    registry.reset();

    const pageType = resolvePageType(page.pageType);
    const effective = resolveLayout({
      default: { layout: pageType.defaultLayout, locks: pageType.descriptor.locks },
    });
    const pageContext = buildPageContext(pageType, page.entityId);
    el.context = pageContext;
    // Resolve a friendly display name for each widget's error-boundary fallback
    // card (SPEC §6/§8): a failed first-party widget (e.g. the crasher demo) shows
    // its name + Retry, while an unknown tag stays an anonymous card. The name
    // source is the widget registry (import map), so it lives beside `describeWidget`.
    el.widgetDescriptor = describeWidget;

    // The per-mount handle inputs shared across this page's widgets (SPEC §3: one
    // context for all widgets on a page). The interim handle serves the bound
    // record refs as fixture data so a context consumer reads them back through
    // `sdk.records.read`; a no-context page yields no host data → no-op handles.
    const widgetIds = indexWidgetIds(effective.layout);
    const handleContext = toPageContext(pageContext);
    const hostData = demoHostData(handleContext);

    // Assign the per-instance interim SDK handle onto one mounted widget element.
    // `handleFor` mints on first sight of an instance and returns the same handle
    // thereafter (stable identity), so re-assigning on every render is idempotent.
    const assignHandle = (instanceId: string): void => {
      const element = el.widgetElement(instanceId);
      const widgetId = widgetIds.get(instanceId);
      if (element === undefined || widgetId === undefined) return;
      const handle = registry.handleFor({
        mountKey: instanceId,
        widgetId,
        ...(handleContext !== undefined ? { context: handleContext } : {}),
        ...(hostData !== undefined ? { hostData } : {}),
      });
      assignSdkHandle(element, handle);
    };

    // `gm:rendered` fires after every render reconciles the grid (mounts settled).
    // Reconcile the registry to the placed set (releasing unmounted instances —
    // the Phase-A analog of unmount token revocation) and (re)assign live mounts.
    const onRendered = (event: Event): void => {
      const placed = (event as CustomEvent<CanvasRenderedDetail>).detail.instanceIds;
      registry.reconcile(placed);
      for (const instanceId of placed) assignHandle(instanceId);
    };
    // `gm:widget-mounted` fires when virtualization lazily mounts one widget
    // between full renders — assign its handle straight away (off in Phase A, but
    // this keeps the seam correct if a host enables `virtualize`).
    const onWidgetMounted = (event: Event): void => {
      assignHandle((event as CustomEvent<CanvasWidgetLifecycleDetail>).detail.instanceId);
    };
    el.addEventListener(CANVAS_RENDERED_EVENT, onRendered);
    el.addEventListener(CANVAS_WIDGET_MOUNTED_EVENT, onWidgetMounted);

    // Boot order (SPEC §2): lazily `import()` the referenced widget modules so
    // their custom elements are **registered before** the canvas mounts them —
    // core's widget boundary resolves a tag once, at mount, and falls a
    // still-undefined tag straight to its error card rather than awaiting a later
    // upgrade. `finally` sets the layout even if a remote fails to load, so those
    // widgets get their fallback card while the rest of the page renders (SPEC §7:
    // the shell never blocks on one widget's code).
    let active = true;
    void loadWidgetsForLayout(importMap, effective.layout).finally(() => {
      if (!active || ref.current !== el) return;
      el.layout = effective;
      // Relayout nudge: gridstack (core's canvas binding) sizes each item as a
      // percentage of the grid width, but the items it places on this first mount
      // render collapsed until a reflow re-resolves them — its own resize path is
      // what recomputes them. Dispatching gridstack's window-resize handler once,
      // after the layout is applied, triggers that recompute so the grid reaches
      // full width without a lingering collapsed state. Idempotent and harmless;
      // remove once the core binding lays out correctly on mount (gridmason/core#63).
      requestAnimationFrame(() => {
        if (active && ref.current === el) window.dispatchEvent(new Event('resize'));
      });
    });

    return () => {
      active = false;
      el.removeEventListener(CANVAS_RENDERED_EVENT, onRendered);
      el.removeEventListener(CANVAS_WIDGET_MOUNTED_EVENT, onWidgetMounted);
      registry.reset();
    };
  }, [page.pageType, page.entityId]);

  return (
    <gm-page-canvas
      ref={ref}
      aria-label={CANVAS_LABEL}
      data-page-type={page.pageType}
      {...(page.entityId !== undefined ? { 'data-entity-id': page.entityId } : {})}
    />
  );
}
