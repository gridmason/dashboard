/**
 * The **governance demo** page (FR-4, SPEC §5): a single governed page whose
 * layout is resolved from three levels — the plugin/host **default**, an
 * organization **published** layout (which may add locks), and the user's
 * personal **override** — and whose resolution is made *watchable*.
 *
 * It is not a special-case page renderer: it mounts the same {@link CanvasHost}
 * and {@link AppShell} every route uses, wrapped in the same {@link EditSessionProvider}.
 * What it adds is a {@link GovernancePanel} that (a) drives the operator's
 * publish / un-publish action and (b) renders the three levels side by side — the
 * "resolution made visible" view from mockup 04-governance.html. The user's
 * override + reset flow is the ordinary edit toolbar (Save / Reset to org default)
 * the shell already provides; a locked slot is immovable in that edit mode because
 * the org's locks flow through resolution into the canvas (core marks locked
 * items non-draggable).
 */
import { AppShell } from '../AppShell';
import { CanvasHost } from '../canvas/CanvasHost';
import { EditSessionProvider } from '../edit/edit-session';
import { GovernancePanel } from './GovernancePanel';
import { GOVERNED_PAGE } from './org-publication';

/** The governance showcase, mounted at `/governance`. */
export function GovernanceView(): React.JSX.Element {
  return (
    <EditSessionProvider page={GOVERNED_PAGE}>
      <AppShell page={GOVERNED_PAGE}>
        <GovernancePanel />
        <CanvasHost page={GOVERNED_PAGE} />
      </AppShell>
    </EditSessionProvider>
  );
}
