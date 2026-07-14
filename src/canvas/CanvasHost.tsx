import { useEffect } from 'react';
import { PageCanvas } from '@gridmason/core/canvas';
import 'gridstack/dist/gridstack.css';
import './canvas-host.css';

import type { PageRef } from '../routes';
import { resolvePageType } from '../pages/page-types';
import { buildPageContext } from '../pages/context';
import { assembleImportMap, loadWidgetsForLayout } from '../boot/import-map';
import { useEditSession } from '../edit/edit-session';

// Register `<gm-page-canvas>` once, at module load. In core 0.3.0 importing the
// canvas module no longer defines the element as a side effect — `define()` is
// explicit and idempotent, so a host calls it freely (SPEC §2).
PageCanvas.define();

/** Canonical accessible name for the page canvas (mockup 01-canvas.html). */
export const CANVAS_LABEL = 'Page canvas — grid of widgets';

/** The local import map is assembled once — Phase A has no gate/registry inputs to vary it. */
const importMap = assembleImportMap();

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
 */
export function CanvasHost({ page }: { page: PageRef }): React.JSX.Element {
  const { canvasRef, effective } = useEditSession();

  useEffect(() => {
    const el = canvasRef.current;
    if (el === null || effective === undefined) return;

    const pageType = resolvePageType(page.pageType);
    el.context = buildPageContext(pageType, page.entityId);

    // Boot order (SPEC §2): lazily `import()` the referenced widget modules so
    // their custom elements are **registered before** the canvas mounts them —
    // core's widget boundary resolves a tag once, at mount, and falls a
    // still-undefined tag straight to its error card rather than awaiting a later
    // upgrade. `finally` sets the layout even if a remote fails to load, so those
    // widgets get their fallback card while the rest of the page renders (SPEC §7:
    // the shell never blocks on one widget's code).
    let active = true;
    void loadWidgetsForLayout(importMap, effective.layout).finally(() => {
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
    };
  }, [canvasRef, effective, page.pageType, page.entityId]);

  return (
    <gm-page-canvas
      ref={canvasRef}
      aria-label={CANVAS_LABEL}
      data-page-type={page.pageType}
      {...(page.entityId !== undefined ? { 'data-entity-id': page.entityId } : {})}
    />
  );
}
