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
   * Resolves a display name for a widget instance's error-boundary fallback card
   * (SPEC §6/§8). The host sets it so a failed first-party widget shows its name +
   * Retry; an unresolved tag stays an anonymous card.
   */
  widgetDescriptor: WidgetDescriptor | undefined;
  /**
   * The mounted widget element for a placed instance id, or `undefined` when it
   * is not mounted (unmounted, virtualized offscreen, or in its error state). The
   * host reads it to assign each mount's per-instance interim SDK handle (FR-9).
   */
  widgetElement(instanceId: string): HTMLElement | undefined;
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
