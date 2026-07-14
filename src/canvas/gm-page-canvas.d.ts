import type { HTMLAttributes } from 'react';

/**
 * JSX typing for core's `<gm-page-canvas>` custom element (SPEC §2). The element
 * itself is defined by `@gridmason/core/canvas` and registered as a side effect
 * of importing that module; core 0.1.0 ships it as a placeholder (renders
 * empty) with the live element arriving in the C-E2 release. The host only ever
 * addresses it through these attributes, so a version bump is the sole change
 * needed once the element is live.
 */
interface GmPageCanvasAttributes extends HTMLAttributes<HTMLElement> {
  /** Page-type identity the canvas resolves its layout from, e.g. `dashboards.home`. */
  'page-type': string;
  /** Optional entity the page is scoped to (typed-context pages, SPEC §5). */
  'entity-id'?: string;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'gm-page-canvas': GmPageCanvasAttributes;
    }
  }
}
