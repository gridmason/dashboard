/**
 * The **Add widget** edit-toolbar affordance (issue #85) — prod-safe, shown while
 * the page is in edit mode in **every** build. It replaces the former dev-only
 * `DevSideloadControls`: adding a widget (local, registry-catalog, or acknowledged)
 * is core functionality, and the dev-sideload section it also hosts is gated inside
 * the picker under `import.meta.env.DEV`. A thin shell over {@link AddWidgetPicker}
 * so `AppShell` needs only one line.
 */
import { useState } from 'react';
import type { PageRef } from '../routes';
import { AddWidgetPicker } from './AddWidgetPicker';

export function AddWidgetControls({ page }: { page: PageRef }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="gm-picker-addbtn" onClick={() => setOpen(true)}>
        Add widget
      </button>
      {open ? <AddWidgetPicker page={page} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
