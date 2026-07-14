// Importing the canvas module registers core's `<gm-page-canvas>` custom element
// as a side effect (SPEC §2). In core 0.1.0 this is an explicit placeholder: the
// element is not yet defined, so the tag renders empty — which this bootstrap
// stage allows. The live element arrives with core C-E2; bumping the core
// version is then the only change required here.
import '@gridmason/core/canvas';

import type { PageRef } from '../routes';

/** Canonical accessible name for the page canvas (mockup 01-canvas.html). */
export const CANVAS_LABEL = 'Page canvas — grid of widgets';

/**
 * The one and only page renderer (FR-1). Every route mounts this; it holds no
 * page-type-specific logic — it hands the resolved {@link PageRef} to core's
 * `<gm-page-canvas>` and nothing more. Keeping this the sole render path is the
 * "no special-case pages" invariant that later epics build page types on.
 */
export function CanvasHost({ page }: { page: PageRef }): React.JSX.Element {
  return (
    <gm-page-canvas
      aria-label={CANVAS_LABEL}
      page-type={page.pageType}
      {...(page.entityId !== undefined ? { 'entity-id': page.entityId } : {})}
    />
  );
}
