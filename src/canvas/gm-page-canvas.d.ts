import type { DetailedHTMLProps, HTMLAttributes, Ref } from 'react';
import type { EffectiveLayout } from '@gridmason/core/engine';
import type { WidgetDescriptor } from '@gridmason/core/canvas';

/**
 * JSX typing for core's `<gm-page-canvas>` custom element (SPEC §2), as it is in
 * `@gridmason/core@0.3.0`. The element is driven by **imperative properties**,
 * not attributes: the shell sets `layout` (the resolved {@link EffectiveLayout})
 * and `context` (the typed page-context value) through a ref — the canvas has no
 * `page-type`/`entity-id` attributes. The class is registered by
 * `PageCanvas.define()` (see `CanvasHost`), not as an import side effect.
 *
 * Only the property surface the dashboard actually drives is declared here; the
 * host addresses nothing else, so this stays a thin, purpose-built view of the
 * element rather than a mirror of the full core class.
 */
export interface GmPageCanvasElement extends HTMLElement {
  /** The resolved layout to render; assigning it re-renders the canvas. */
  layout: EffectiveLayout | undefined;
  /** The typed page-context value, serialized to every widget's `context` attribute. */
  context: unknown;
  /**
   * Whether the canvas is in edit mode (gridstack drag/resize enabled). The
   * edit-mode controller drives this; declared here so the element satisfies
   * core's `EditableCanvas` when handed to an `EditController`.
   */
  editMode: boolean;
  /** The active tab index for a tabbed layout (0 for a single-grid page). */
  activeTab: number;
  /**
   * Resolves a display name for a widget instance's error-boundary fallback card
   * (SPEC §6/§8). The host sets it so a failed first-party widget shows its name +
   * Retry; an unresolved tag stays an anonymous card.
   */
  widgetDescriptor: WidgetDescriptor | undefined;
  /**
   * The instance ids currently mounted on the active grid, in mount order. The
   * host reads it to scope a dev hot-reload remount to instances that are actually
   * mounted (SPEC §4, FR-9/FR-7).
   */
  readonly mountedInstanceIds: readonly string[];
  /**
   * The mounted widget element for a placed instance id, or `undefined` when it
   * is not mounted (unmounted, virtualized offscreen, or in its error state). The
   * host reads it to assign each mount's per-instance interim SDK handle (FR-9).
   */
  widgetElement(instanceId: string): HTMLElement | undefined;
  /**
   * The gridstack **item** element (`.grid-stack-item`) wrapping a placed
   * instance, or `undefined` when it is not placed on the active grid. The host
   * reads it to overlay the distinct sideload badge on a dev-sideloaded widget's
   * card (SPEC §4) — the item is the card-level surface, so the badge rides the
   * widget through drag/resize.
   */
  itemElement(instanceId: string): HTMLElement | undefined;
}

/** Attributes/props accepted on `<gm-page-canvas>` in JSX, including a typed `ref`. */
interface GmPageCanvasAttributes extends HTMLAttributes<GmPageCanvasElement> {
  ref?: Ref<GmPageCanvasElement>;
  /** Observability only (route → rendered page type); not part of the core ABI. */
  'data-page-type'?: string;
  /** Observability only (entity-scoped pages); not part of the core ABI. */
  'data-entity-id'?: string;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'gm-page-canvas': DetailedHTMLProps<GmPageCanvasAttributes, GmPageCanvasElement>;
    }
  }
}
