import type { DetailedHTMLProps, HTMLAttributes, Ref } from 'react';
import type { EffectiveLayout } from '@gridmason/core/engine';

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
