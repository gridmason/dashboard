/**
 * The acknowledged-sideload provider (docs/SPEC.md §4, FR-8) — **always mounted**,
 * in every build. Where the dev-sideload provider is dev-only and holds a
 * session-only allowlist, this one is prod-safe and reads the **persistent**
 * registrations the demo API stores, because `acknowledged` mode is available in
 * production (SPEC §4 restricts only `dev` to dev builds).
 *
 * On mount it ensures a session, loads the persisted registrations, resolves each
 * into a mountable {@link AcknowledgedRemote} ({@link ApiAcknowledgedSideload}), and
 * installs the prod-safe {@link installAcknowledgedSideloadHost} seam the canvas
 * render path reads to (a) merge acknowledged remotes into the import map — each
 * carrying the hash-verifying loader ({@link acknowledgedRemote}) — and (b) badge
 * acknowledged cards distinctly. Registering/deregistering is surfaced to the dev
 * add-widget picker (the Phase-A authoring surface); a persisted registration then
 * loads and badges on any build, including production, from a saved layout.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { WidgetID } from '@gridmason/protocol';

import { ApiAcknowledgedSideload, type AcknowledgedRemote } from './acknowledged-store';
import { acknowledgedRemote } from './acknowledged-remotes';
import { installAcknowledgedSideloadHost } from './host-seam';
import { acknowledgedSideloadEnabled } from './policy';

/** The acknowledged-sideload surface exposed to the add-widget picker. */
export interface AcknowledgedSideloadSession {
  /**
   * Whether the deploy's posture is `acknowledged` (SPEC §4). `off` (the default)
   * and `dev` leave this `false`, and when it is `false` no registration is
   * resolved, fetched, or installed — the gate the sideload-gate e2e drives.
   */
  readonly enabled: boolean;
  /** The resolved, mountable acknowledged remotes (reactive). Always empty when `enabled` is `false`. */
  readonly remotes: readonly AcknowledgedRemote[];
  /** Re-read the persisted registrations from the API. */
  refresh(): Promise<void>;
  /**
   * Register a remote by URL, pinning its content hash now (SPEC §4). The server
   * records the session user as the acknowledger. Rejects with a human message the
   * picker shows (bad URL, unreachable remote, or `403` for a non-owner).
   */
  register(url: string): Promise<void>;
  /** Deregister the remote registered at `url`. */
  remove(url: string): Promise<void>;
  /** `import()` a remote's verified entry so its custom element is defined before it is placed. */
  loadModule(remote: AcknowledgedRemote): Promise<void>;
  /** Record that `instanceId` was just placed as `widgetID` (pre-Save badge + handle bridge). */
  notePlacement(instanceId: string, widgetID: WidgetID): void;
}

const AcknowledgedCtx = createContext<AcknowledgedSideloadSession | undefined>(undefined);

/** Read the acknowledged-sideload session. Throws outside an {@link AcknowledgedSideloadProvider}. */
export function useAcknowledgedSideload(): AcknowledgedSideloadSession {
  const session = useContext(AcknowledgedCtx);
  if (session === undefined) {
    throw new Error('useAcknowledgedSideload must be used within an <AcknowledgedSideloadProvider>');
  }
  return session;
}

/** Base URL the demo API is served under — `''` (same-origin proxy), as elsewhere. */
const DEMO_API_BASE = '';

export function AcknowledgedSideloadProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // The deploy's sideload posture (build-time constant). When acknowledged mode is
  // off — the default — this provider stays inert: it never fetches a registration,
  // never resolves a remote, and installs nothing, so no acknowledged origin reaches
  // the import map (SPEC §4 `off`; the invariant the sideload-gate e2e proves).
  const enabled = acknowledgedSideloadEnabled();

  const adapterRef = useRef<ApiAcknowledgedSideload>(null);
  adapterRef.current ??= new ApiAcknowledgedSideload({ baseUrl: DEMO_API_BASE });
  const adapter = adapterRef.current;

  // Instances the picker placed this session, so the canvas can badge + mint a
  // handle for an acknowledged widget before a Save re-resolves `effective`.
  const placementsRef = useRef<Map<string, WidgetID>>(null);
  placementsRef.current ??= new Map<string, WidgetID>();

  const [remotes, setRemotes] = useState<readonly AcknowledgedRemote[]>([]);

  const refresh = useCallback(async () => {
    setRemotes(await adapter.resolveRemotes());
  }, [adapter]);

  // Load the persisted registrations. The read is session-gated, and the session
  // is established elsewhere (the edit session signs in the stub user), so on a
  // cold first visit this read can land before the cookie is set: tolerate that
  // with a single short retry, by which point the session exists. A reload reuses
  // the `HttpOnly` cookie and the first read succeeds. Failures are swallowed — the
  // dashboard renders without acknowledged remotes rather than blocking.
  useEffect(() => {
    if (!enabled) return; // acknowledged mode off (default) → never fetch a registration
    let active = true;
    void (async () => {
      try {
        await refresh();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (active) await refresh().catch(() => undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled, refresh]);

  // Install the prod-safe seam the canvas render path reads. Re-installed whenever
  // the resolved remote set changes, so a just-registered remote is mountable and
  // badged without a reload.
  useEffect(() => {
    if (!enabled) {
      // Acknowledged mode off (default): install nothing, so the canvas render
      // path sees no acknowledged remote in the import map (SPEC §4 `off`).
      installAcknowledgedSideloadHost(null);
      return;
    }
    installAcknowledgedSideloadHost({
      remotes: () => remotes.map((remote) => acknowledgedRemote(remote)),
      describe: (id: WidgetID) => {
        const match = remotes.find(
          (remote) => remote.widgetID.source === id.source && remote.tag === id.tag,
        );
        return match?.name;
      },
      widgetIdForInstance: (instanceId: string) => placementsRef.current?.get(instanceId),
    });
    return () => installAcknowledgedSideloadHost(null);
  }, [enabled, remotes]);

  const register = useCallback(
    async (url: string) => {
      await adapter.register(url);
      await refresh();
    },
    [adapter, refresh],
  );

  const remove = useCallback(
    async (url: string) => {
      await adapter.remove(url);
      await refresh();
    },
    [adapter, refresh],
  );

  const loadModule = useCallback(async (remote: AcknowledgedRemote): Promise<void> => {
    await acknowledgedRemote(remote).load();
  }, []);

  const notePlacement = useCallback((instanceId: string, widgetID: WidgetID) => {
    placementsRef.current?.set(instanceId, widgetID);
  }, []);

  const session = useMemo<AcknowledgedSideloadSession>(
    () => ({ enabled, remotes, refresh, register, remove, loadModule, notePlacement }),
    [enabled, remotes, refresh, register, remove, loadModule, notePlacement],
  );

  return <AcknowledgedCtx.Provider value={session}>{children}</AcknowledgedCtx.Provider>;
}
