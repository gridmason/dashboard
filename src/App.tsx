import { Route, Switch } from 'wouter';
import { AppShell } from './AppShell';
import { CanvasHost } from './canvas/CanvasHost';
import { EditSessionProvider } from './edit/edit-session';
import { GovernanceView } from './governance/GovernanceView';
import { ROUTES, resolvePageRef } from './routes';

/**
 * Resolve raw route params to a page ref and render the single canvas host
 * inside the shell. This is the only bridge from URL to view — there is no
 * per-page-type component (FR-1).
 *
 * The {@link EditSessionProvider} wraps both so the shell's edit toolbar and the
 * canvas share one session — resolution, persistence, and edit mode (SPEC §5).
 */
function PageView(params: { pageType?: string; entityId?: string }): React.JSX.Element {
  const page = resolvePageRef(params);
  return (
    <EditSessionProvider page={page}>
      <AppShell page={page}>
        <CanvasHost page={page} />
      </AppShell>
    </EditSessionProvider>
  );
}

/**
 * The routing shell. Every route funnels into {@link PageView}; adding a page
 * type never adds a route component, only data. The trailing catch-all route
 * keeps unknown paths on the canvas host (resolving the default page type)
 * rather than dead-ending — the app always renders a canvas.
 */
export function App(): React.JSX.Element {
  return (
    <Switch>
      <Route path={ROUTES.governance}>{() => <GovernanceView />}</Route>
      <Route path={ROUTES.pageEntity}>
        {(params) => <PageView pageType={params.pageType} entityId={params.entityId} />}
      </Route>
      <Route path={ROUTES.page}>
        {(params) => <PageView pageType={params.pageType} />}
      </Route>
      <Route>{() => <PageView />}</Route>
    </Switch>
  );
}
