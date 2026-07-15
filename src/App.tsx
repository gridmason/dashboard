import type { ReactNode } from 'react';
import { Route, Router, Switch } from 'wouter';
import { AppShell } from './AppShell';
import { CanvasHost } from './canvas/CanvasHost';
import { EditSessionProvider } from './edit/edit-session';
import { GovernanceView } from './governance/GovernanceView';
import { ROUTES, resolvePageRef } from './routes';
import { DevSideloadProvider } from './sideload';
import { AcknowledgedSideloadProvider } from './sideload/AcknowledgedSideloadContext';
import { FederatedBootProvider } from './boot/FederatedBootProvider';

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
 *
 * The whole app is wrapped in the **federated-boot** provider (SPEC §2, FR-10),
 * which resolves + verifies a configured registry's remotes and exposes the verified
 * ones to the canvas — inert (installs nothing) until a deployment configures a
 * registry, so it is a no-op on the default showcase. Inside it, the app is wrapped
 * in the **acknowledged**-sideload session (SPEC §4, FR-8), which is prod-safe —
 * acknowledged mode is available in production builds — so it is mounted on every
 * build. In a **development build only** the router is
 * additionally wrapped in the **dev**-sideload session (FR-7): `import.meta.env.DEV`
 * is a static `false` in a production build, so `<DevSideloadProvider>` is dead
 * code there and drops the entire dev `./sideload` subtree from the bundle — dev
 * sideload is unavailable in production (`production-gate.test.ts`, `sideload-gate`
 * e2e), while acknowledged sideload stays available.
 *
 * All routes are scoped to the deploy's base path via wouter's {@link Router}
 * `base`, read from Vite's `import.meta.env.BASE_URL` (the build's `base`, e.g.
 * `/demo/` for GitHub Pages subpath hosting). It is `/` — an empty base, i.e. the
 * root — for a normal build, so this is a no-op there and only takes effect when a
 * subpath build sets it.
 */
export function App(): React.JSX.Element {
  // `/demo/` → `/demo`; `/` → `` (root). wouter matches paths after this prefix.
  const routerBase = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return (
    <FederatedBootProvider>
      <AcknowledgedSideloadProvider>
        {withDevSideload(
          <Router base={routerBase}>
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
          </Router>,
        )}
      </AcknowledgedSideloadProvider>
    </FederatedBootProvider>
  );
}

/** Wrap the app in the dev-sideload provider in a dev build; a no-op in production. */
function withDevSideload(children: ReactNode): React.JSX.Element {
  if (import.meta.env.DEV) {
    return <DevSideloadProvider>{children}</DevSideloadProvider>;
  }
  return <>{children}</>;
}
