/**
 * The dev-sideload session provider (docs/SPEC.md §4, FR-7) — **development
 * builds only**.
 *
 * This is the composition root of the dev-sideload feature: it owns the
 * per-session {@link DevSideloadAllowlist} (nothing persisted), the owner's
 * acknowledgement of the dev gate (SPEC §4: "unlocked only by an owner
 * acknowledgement… accepts the risk of unreviewed code"), and the placement map
 * that lets a just-added sideload widget carry its badge + interim handle before
 * a Save re-resolves the layout. It installs those into the prod-safe
 * {@link installSideloadHost} seam so the canvas render path can consult them
 * without importing any of this dev-only code.
 *
 * The entire module is reached only under `import.meta.env.DEV` (App wraps the
 * router with it only in a dev build, and `./index` re-exports it only for that
 * branch), so a production build drops it wholesale — the dev gate is genuinely
 * unavailable in production (`production-gate.test.ts`, `sideload-gate` e2e).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import type { WidgetID } from '@gridmason/protocol';

import { DevSideloadAllowlist, type DevSideloadRemote } from './allowlist-store';
import { fetchDevManifest, normalizeOrigin } from './manifest';
import { sideloadRemote } from './remotes';
import { installSideloadHost } from './host-seam';
// Imported as an inlined string (not a side-effect CSS import) and injected at
// runtime below, so the styles ride this dev-only module: a side-effect
// `import './sideload.css'` would be bundled into the production CSS even though
// this module's JS is tree-shaken out (Vite treats CSS imports as side effects).
// `?inline` makes it a plain string constant that dead-code-elimination drops
// with the rest of the dev subtree (proven by `production-gate.test.ts`).
import sideloadCss from './sideload.css?inline';

/** The dev-sideload session surface exposed to the dev UI (picker + panel). */
export interface DevSideloadSession {
  /** Whether the owner has acknowledged the dev gate (unlocking registration + mounting). */
  readonly acknowledged: boolean;
  /** The admitted remotes this session (reactive). */
  readonly remotes: readonly DevSideloadRemote[];
  /** Accept the dev-gate risk disclaimer, unlocking sideload for this session. */
  acknowledge(): void;
  /** Re-lock the dev gate: clear the acknowledgement **and** every admitted remote. */
  revoke(): void;
  /**
   * Admit the `gridmason dev` remote at `origin`: fetch + validate its descriptor,
   * then add it to the allowlist. Rejects with a human message the UI shows.
   * Requires {@link acknowledged}.
   */
  register(origin: string): Promise<DevSideloadRemote>;
  /** Remove the admitted remote registered from `origin`. */
  remove(origin: string): void;
  /** `import()` a remote's entry module so its custom element is defined before it is placed. */
  loadModule(remote: DevSideloadRemote): Promise<void>;
  /** Record that `instanceId` was just placed as `widgetID` (pre-Save badge + handle bridge). */
  notePlacement(instanceId: string, widgetID: WidgetID): void;
}

const DevSideloadCtx = createContext<DevSideloadSession | undefined>(undefined);

/** Read the dev-sideload session. Throws outside a {@link DevSideloadProvider} (dev builds only). */
export function useDevSideload(): DevSideloadSession {
  const session = useContext(DevSideloadCtx);
  if (session === undefined) {
    throw new Error('useDevSideload must be used within a <DevSideloadProvider>');
  }
  return session;
}

export function DevSideloadProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const storeRef = useRef<DevSideloadAllowlist>(null);
  storeRef.current ??= new DevSideloadAllowlist();
  const store = storeRef.current;

  // Instances the picker placed this session, so the canvas can badge + handle a
  // sideload widget before a Save re-resolves `effective` (which will then list it).
  const placementsRef = useRef<Map<string, WidgetID>>(null);
  placementsRef.current ??= new Map<string, WidgetID>();

  const [acknowledged, setAcknowledged] = useState(false);

  // Inject the dev-sideload styles once, from this dev-only provider (see the
  // import note). Removed on unmount so nothing lingers.
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.gmDevSideload = '';
    style.textContent = sideloadCss;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const remotes = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.snapshot(),
    () => store.snapshot(),
  );

  // Install the prod-safe seam the canvas render path reads. The closures capture
  // the live store + placement map, so the canvas always sees current state.
  useEffect(() => {
    installSideloadHost({
      remotes: () => store.snapshot().map(sideloadRemote),
      describe: (id: WidgetID) => {
        const remote = store.byTag(id.tag);
        return remote !== undefined && remote.widgetID.source === id.source
          ? remote.name
          : undefined;
      },
      widgetIdForInstance: (instanceId: string) => placementsRef.current?.get(instanceId),
    });
    return () => installSideloadHost(null);
  }, [store]);

  const acknowledge = useCallback(() => setAcknowledged(true), []);

  const revoke = useCallback(() => {
    setAcknowledged(false);
    store.clear();
    placementsRef.current?.clear();
  }, [store]);

  const register = useCallback(
    async (origin: string): Promise<DevSideloadRemote> => {
      if (!acknowledged) throw new Error('acknowledge the dev-sideload risk first');
      const normalized = normalizeOrigin(origin);
      const registration = await fetchDevManifest(normalized);
      return store.register(registration);
    },
    [acknowledged, store],
  );

  const remove = useCallback(
    (origin: string) => {
      store.remove(origin);
    },
    [store],
  );

  const loadModule = useCallback(async (remote: DevSideloadRemote): Promise<void> => {
    await sideloadRemote(remote).load();
  }, []);

  const notePlacement = useCallback((instanceId: string, widgetID: WidgetID) => {
    placementsRef.current?.set(instanceId, widgetID);
  }, []);

  const session = useMemo<DevSideloadSession>(
    () => ({
      acknowledged,
      remotes,
      acknowledge,
      revoke,
      register,
      remove,
      loadModule,
      notePlacement,
    }),
    [acknowledged, remotes, acknowledge, revoke, register, remove, loadModule, notePlacement],
  );

  return <DevSideloadCtx.Provider value={session}>{children}</DevSideloadCtx.Provider>;
}
