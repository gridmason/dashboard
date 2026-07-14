/**
 * The dev-sideload toolbar affordance (docs/SPEC.md §4) — **development builds
 * only**. Rendered by `AppShell` behind an `import.meta.env.DEV` guard, so it is
 * absent from a production build entirely (`sideload-gate` e2e).
 *
 * It surfaces an **Add widget** button while the page is in edit mode (the author
 * loop is a governed edit), opening the {@link AddWidgetPicker}. Kept as a thin
 * shell over the picker so `AppShell` needs only one dev-gated line.
 */
import { useState } from 'react';
import type { PageRef } from '../routes';
import { AddWidgetPicker } from './AddWidgetPicker';

export function DevSideloadControls({ page }: { page: PageRef }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="gm-sl-addbtn" onClick={() => setOpen(true)}>
        Add widget
      </button>
      {open ? <AddWidgetPicker page={page} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
