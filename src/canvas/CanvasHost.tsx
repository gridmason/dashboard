import { useEffect, useRef } from 'react';
import {
  PageCanvas,
  CANVAS_RENDERED_EVENT,
  CANVAS_WIDGET_MOUNTED_EVENT,
  assignSdkHandle,
  type CanvasRenderedDetail,
  type CanvasWidgetLifecycleDetail,
} from '@gridmason/core/canvas';
import type { LayoutPage, WidgetID } from '@gridmason/protocol';
import 'gridstack/dist/gridstack.css';
import './canvas-host.css';

import type { PageRef } from '../routes';
import { resolvePageType } from '../pages/page-types';
import { buildPageContext } from '../pages/context';
import { assembleImportMap, describeWidget, loadWidgetsForLayout } from '../boot/import-map';
import type { LocalImportMap, LocalRemote } from '../boot/import-map';
import { InterimHandleRegistry, toPageContext, demoHostData } from '../host-sdk';
import { useEditSession } from '../edit/edit-session';
import { acknowledgedSideloadHost, sideloadHost, subscribeDevReload } from '../sideload/host-seam';
import { remountInstancesByTag } from '../sideload/remount';
import { ACKNOWLEDGED_BADGE_LABEL, isSideloadedId, SIDELOAD_BADGE_LABEL } from '../sideload/source';
// Acknowledged-sideload badge styling — prod-safe (acknowledged mode ships in
// production builds), so it is a real side-effect CSS import here, unlike the
// dev-sideload styles which the dev-only provider injects.
import '../sideload/acknowledged.css';

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
 * The active import map for a render: the shell's local remotes, plus the
 * acknowledged-sideload remotes (SPEC §4, FR-8 — prod-safe, merged on every build)
 * and, in a **development build** with the dev gate active, the admitted
 * dev-sideload remotes (FR-7). Every sideloaded remote is merged in by tag so it
 * rides the exact same lazy-`import()` mount path as a first-party one — an
 * acknowledged remote's loader additionally verifies its content hash before the
 * module runs ({@link acknowledgedRemote}). In a production build
 * `import.meta.env.DEV` is a static `false`, so the dev seam is never referenced.
 */
function activeImportMap(): LocalImportMap {
  const acknowledged = acknowledgedSideloadHost();
  const dev = import.meta.env.DEV ? sideloadHost() : null;
  if (acknowledged === null && dev === null) return importMap;
  const merged = new Map(importMap);
  if (acknowledged !== null) for (const remote of acknowledged.remotes()) merged.set(remote.tag, remote);
  if (dev !== null) for (const remote of dev.remotes()) merged.set(remote.tag, remote);
  return merged;
}

/**
 * Add a distinct sideload badge to a placed instance's grid item, once (SPEC §4:
 * "every sideloaded widget is marked distinctly in the UI"; mockup 01 `.badge.side`).
 * The `className` + `label` distinguish an **acknowledged** remote (`gm-ack-badge`)
 * from a **dev** one (`gm-sideload-badge`). Idempotent — the render fires on every
 * reconcile, so it guards on an existing badge of the same kind.
 */
function markSideloadItem(item: HTMLElement | undefined, className: string, label: string): void {
  if (item === undefined || item.querySelector(`:scope > .${className}`) !== null) return;
  const badge = item.ownerDocument.createElement('span');
  badge.className = className;
  badge.textContent = label;
  item.appendChild(badge);
}

/**
 * The remote in `remotes` a placed instance is served by — matched by its resolved
 * `sideload:<origin>` identity or, for a widget the picker just placed (whose
 * identity note may land only after this synchronous render), by its mounted
 * element's tag. `undefined` if the instance is not one of `remotes`.
 */
function matchSideloadRemote(
  remotes: readonly LocalRemote[],
  widgetId: WidgetID | undefined,
  element: Element | undefined,
): LocalRemote | undefined {
  return remotes.find(
    (remote) =>
      (widgetId !== undefined && remote.source === widgetId.source && remote.tag === widgetId.tag) ||
      (element !== undefined && remote.tag === element.localName),
  );
}

/**
 * The one and only page renderer (FR-1). Every route mounts this; it holds no
 * page-type-specific logic. Keeping this the sole render path is the "no
 * special-case pages" invariant later epics build page types on.
 *
 * Resolution and persistence live in the {@link useEditSession} provider: it signs
 * in, composes the effective layout from the page-type default, any org layout,
 * and the user's saved override (3-level resolution, SPEC §5), and owns edit mode.
 * This host is the DOM half — it renders whatever {@link EffectiveLayout} the
 * session publishes: for each new layout it lazily `import()`s the referenced
 * widget modules (registering their elements) and hands the layout and typed
 * context to core's `<gm-page-canvas>` through the session's ref. The canvas is
 * driven by properties, so the imperative ref is the seam, not JSX.
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
  const { canvasRef, effective } = useEditSession();
  // One interim-handle registry per canvas host: it owns this page's per-instance
  // handles and their stable identities across re-renders (`../host-sdk/registry`).
  const registryRef = useRef<InterimHandleRegistry>(null);
  registryRef.current ??= new InterimHandleRegistry();

  useEffect(() => {
    const el = canvasRef.current;
    if (el === null || effective === undefined) return;
    const registry = registryRef.current!;
    // New layout = all-new instances: drop the previous render's handles so a
    // reused grid-item id mints a fresh identity rather than inheriting the old one.
    registry.reset();

    const pageType = resolvePageType(page.pageType);
    const pageContext = buildPageContext(pageType, page.entityId);
    el.context = pageContext;
    // Resolve a friendly display name for each widget's error-boundary fallback
    // card (SPEC §6/§8): a failed first-party widget (e.g. the crasher demo) shows
    // its name + Retry, while an unknown tag stays an anonymous card. The name
    // source is the widget registry (import map), so it lives beside `describeWidget`.
    // In a dev build a sideloaded widget resolves its name through the seam too, so
    // an admitted dev remote is named on its card rather than left anonymous. The
    // seam is read **fresh** at call time (not captured): the dev provider is an
    // ancestor, and a child's effect runs before its parent's, so the seam may not
    // be installed yet when this effect first runs.
    el.widgetDescriptor = (identity) =>
      describeWidget(identity) ??
      acknowledgedSideloadHost()?.describe(identity.widgetID) ??
      (import.meta.env.DEV ? sideloadHost()?.describe(identity.widgetID) : undefined);

    // The per-mount handle inputs shared across this page's widgets (SPEC §3: one
    // context for all widgets on a page). The interim handle serves the bound
    // record refs as fixture data so a context consumer reads them back through
    // `sdk.records.read`; a no-context page yields no host data → no-op handles.
    const widgetIds = indexWidgetIds(effective.layout);
    const handleContext = toPageContext(pageContext);
    const hostData = demoHostData(handleContext);

    // The identity of a placed instance: from the resolved layout, or — for a
    // sideload widget the dev picker just added this session (not yet in `effective`,
    // which a reload would re-resolve) — from the seam's placement bridge (SPEC §4).
    // Drives both the interim handle and the sideload badge.
    const widgetIdOf = (instanceId: string): WidgetID | undefined =>
      widgetIds.get(instanceId) ??
      acknowledgedSideloadHost()?.widgetIdForInstance(instanceId) ??
      (import.meta.env.DEV ? sideloadHost()?.widgetIdForInstance(instanceId) : undefined);

    // Assign the per-instance interim SDK handle onto one mounted widget element.
    // `handleFor` mints on first sight of an instance and returns the same handle
    // thereafter (stable identity), so re-assigning on every render is idempotent.
    const assignHandle = (instanceId: string): void => {
      const element = el.widgetElement(instanceId);
      const widgetId = widgetIdOf(instanceId);
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
      for (const instanceId of placed) {
        assignHandle(instanceId);
        // Mark a sideloaded instance's card distinctly (SPEC §4). A first-party or
        // registry widget is never a match and gets no badge. An instance matches by
        // its resolved `sideload:<origin>` identity (persisted/re-resolved case), or
        // — for a widget the picker just added, whose placement note lands only
        // *after* this synchronous render — by its mounted element's tag. Seams are
        // read fresh (see the descriptor note). Acknowledged sideload is prod-safe,
        // so its badge is decided on every build and takes precedence; the dev badge
        // only in a dev build, and never for an already-acknowledged instance.
        const widgetId = widgetIdOf(instanceId);
        const element = el.widgetElement(instanceId);
        const acknowledged = acknowledgedSideloadHost();
        const ackMatch =
          acknowledged === null
            ? undefined
            : matchSideloadRemote(acknowledged.remotes(), widgetId, element);
        if (ackMatch !== undefined) {
          markSideloadItem(el.itemElement(instanceId), 'gm-ack-badge', ACKNOWLEDGED_BADGE_LABEL);
        } else if (import.meta.env.DEV) {
          const host = sideloadHost();
          if (host !== null) {
            const sideloaded =
              (widgetId !== undefined && isSideloadedId(widgetId)) ||
              (element !== undefined && host.remotes().some((r) => r.tag === element.localName));
            if (sideloaded) markSideloadItem(el.itemElement(instanceId), 'gm-sideload-badge', SIDELOAD_BADGE_LABEL);
          }
        }
      }
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
    void loadWidgetsForLayout(activeImportMap(), effective.layout).finally(() => {
      if (!active || canvasRef.current !== el) return;
      el.layout = effective;
      // Relayout nudge: gridstack (core's canvas binding) sizes each item as a
      // percentage of the grid width, but the items it places on this first mount
      // render collapsed until a reflow re-resolves them — its own resize path is
      // what recomputes them. Dispatching gridstack's window-resize handler once,
      // after the layout is applied, triggers that recompute so the grid reaches
      // full width without a lingering collapsed state. Idempotent and harmless;
      // remove once the core binding lays out correctly on mount (gridmason/core#63).
      requestAnimationFrame(() => {
        if (active && canvasRef.current === el) window.dispatchEvent(new Event('resize'));
      });
    });

    return () => {
      active = false;
      el.removeEventListener(CANVAS_RENDERED_EVENT, onRendered);
      el.removeEventListener(CANVAS_WIDGET_MOUNTED_EVENT, onWidgetMounted);
      registry.reset();
    };
  }, [canvasRef, effective, page.pageType, page.entityId]);

  // Dev hot-reload (SPEC §4, FR-7, issue #41): when an admitted `gridmason dev`
  // origin re-serves its widget, the dev provider re-imports the entry and
  // publishes a reload signal here; remount that origin's live instances so the
  // re-served change lands without a manual reload (`../sideload/remount` documents
  // why a scoped remount — not a class swap — is the mechanism). Dev-only: in a
  // production build `import.meta.env.DEV` is a static `false`, so the seam is never
  // subscribed to and this is dead code (nothing ever publishes to the bus).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    return subscribeDevReload((signal) => {
      const el = canvasRef.current;
      if (el !== null) remountInstancesByTag(el, signal.tag);
    });
  }, [canvasRef]);

  return (
    <gm-page-canvas
      ref={canvasRef}
      aria-label={CANVAS_LABEL}
      data-page-type={page.pageType}
      {...(page.entityId !== undefined ? { 'data-entity-id': page.entityId } : {})}
    />
  );
}
