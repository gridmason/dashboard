/**
 * The **edit session** (docs/SPEC.md §5, FR-5): the seam that turns a page's
 * layout into a governed, persisted, copy-on-write edit loop. It owns the whole
 * persistence half of the governance demo (the org-publish half is the sibling
 * D-E1.5) and exposes it to the chrome (`AppShell` toolbar) and the canvas host
 * through one context.
 *
 * What it wires together:
 *
 * - **3-level resolution.** A page's rendered layout is `resolveLayout`'d from the
 *   page-type **default** (ships in code), an optional **org** published layout,
 *   and the user's personal **override** — most-specific wins, locked slots merge
 *   down (SPEC §5). The default and org come from upstream; the override is read
 *   from the reference persistence adapter under the user's {@link ScopeKey}.
 * - **Copy-on-write edits.** Edit mode is core's {@link EditController}: the first
 *   genuine edit of an inherited layout forks a personal copy rather than mutating
 *   the default/org document, and each commit is staged through a
 *   {@link BufferedLayoutPersistence} port.
 * - **Save / Discard / Reset** (mockup 02-edit-mode.html). **Save** flushes the
 *   staged edit to the API under `user:<id>`; **Discard** drops it and re-resolves
 *   from what is persisted; **Reset to org default** deletes the user override so
 *   resolution falls back to the org/default layout — proving the default was
 *   never mutated.
 *
 * The provider is deliberately the *only* place that fetches, resolves, and
 * persists a layout; `CanvasHost` just renders the {@link EffectiveLayout} it
 * publishes, and the toolbar just calls its actions.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import type { LayoutPage } from '@gridmason/protocol';
import { EditController } from '@gridmason/core/canvas';
import { resolveLayout, type EffectiveLayout, type ScopeKey } from '@gridmason/core/engine';

import type { PageRef } from '../routes';
import type { GmPageCanvasElement } from '../canvas/gm-page-canvas';
import { resolvePageType, type DemoPageType } from '../pages/page-types';
import { ApiLayoutPersistence, type LayoutPersistenceAdapter } from '../adapters/persistence';
import { ensureSession } from '../adapters/session/session-client';
import { BufferedLayoutPersistence } from './buffered-persistence';

/**
 * Base URL the demo API is reached at. Empty means same-origin: the dev server
 * and the preview both proxy `/api` to the demo API (see vite.config.ts), so the
 * ambient `HttpOnly` session cookie authenticates every call.
 */
const DEMO_API_BASE = '';

/** The org scope-node the demo publishes an org layout under (SPEC §5). */
const ORG_NODE = 'org';

/** The edit session a page exposes to its chrome and canvas. */
export interface EditSession {
  /** The ref the canvas host attaches to `<gm-page-canvas>`; the session drives that element. */
  readonly canvasRef: RefObject<GmPageCanvasElement | null>;
  /** The resolved layout to render (default → org → user override), or `undefined` until first resolved. */
  readonly effective: EffectiveLayout | undefined;
  /** Whether the session has signed in and resolved the initial layout. */
  readonly ready: boolean;
  /** Whether this page type permits user customization at all (SPEC §3); the toolbar hides Edit if not. */
  readonly canEdit: boolean;
  /** Whether the canvas is currently in edit mode. */
  readonly editing: boolean;
  /** Whether there is a staged, unsaved edit (enables Save / Discard). */
  readonly dirty: boolean;
  /** Enter edit mode. Inert if the page forbids customization. */
  enter(): void;
  /** Persist the staged edit as the user's override, then leave edit mode (Save layout). */
  save(): Promise<void>;
  /** Drop the staged edit and re-render the last-persisted layout, then leave edit mode (Discard). */
  discard(): Promise<void>;
  /** Delete the user override so the page falls back to the org/default layout (Reset to org default). */
  resetToDefault(): Promise<void>;
}

const EditSessionContext = createContext<EditSession | undefined>(undefined);

/** Read the current page's {@link EditSession}. Throws if used outside an {@link EditSessionProvider}. */
export function useEditSession(): EditSession {
  const session = useContext(EditSessionContext);
  if (session === undefined) {
    throw new Error('useEditSession must be used within an <EditSessionProvider>');
  }
  return session;
}

/** Build the {@link ScopeKey} for a level of a page (SPEC §5 key order). */
function scopeKey(owner: ScopeKey['owner'], page: PageRef): ScopeKey {
  return {
    owner,
    pageType: page.pageType,
    ...(page.entityId !== undefined ? { entityId: page.entityId } : {}),
  };
}

/** Compose the effective layout from the upstream default/org and the user's override (SPEC §5). */
function composeEffective(
  pageType: DemoPageType,
  org: LayoutPage | undefined,
  override: LayoutPage | undefined,
): EffectiveLayout {
  return resolveLayout({
    default: { layout: pageType.defaultLayout, locks: pageType.descriptor.locks },
    ...(org !== undefined ? { org: { layout: org } } : {}),
    ...(override !== undefined ? { user: { layout: override } } : {}),
  });
}

/**
 * Provide the {@link EditSession} for one page. Re-establishes everything when the
 * route's page identity changes; a stale async resolution is discarded by epoch.
 */
export function EditSessionProvider({
  page,
  children,
}: {
  page: PageRef;
  children: ReactNode;
}): React.JSX.Element {
  const canvasRef = useRef<GmPageCanvasElement | null>(null);
  const adapterRef = useRef<LayoutPersistenceAdapter | null>(null);
  const controllerRef = useRef<EditController | null>(null);
  const bufferRef = useRef<BufferedLayoutPersistence | null>(null);
  const pageTypeRef = useRef<DemoPageType | null>(null);
  // The most recent page identity, so async work started for a previous route is
  // ignored once the user navigates.
  const epochRef = useRef(0);

  const [effective, setEffective] = useState<EffectiveLayout | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);

  /**
   * Build a fresh {@link EditController} bound to the live canvas element, seeded
   * from `inherited` (the current resolved layout) as the copy-on-write baseline.
   * Its commits stage through a buffer, so nothing reaches the API until Save.
   */
  const bindController = useCallback((inherited: EffectiveLayout, page_: PageRef, pageType: DemoPageType) => {
    const el = canvasRef.current;
    if (el === null) return;
    controllerRef.current?.dispose();
    const buffer = new BufferedLayoutPersistence(() => setDirty(true));
    bufferRef.current = buffer;
    controllerRef.current = new EditController({
      canvas: el,
      persistence: buffer,
      scopeKey: scopeKey('user', page_),
      inherited,
      allowCustomization: pageType.descriptor.allow_user_customization,
    });
    setEditing(false);
    setDirty(false);
  }, []);

  /**
   * Fetch the user override (and any org layout) for the current page, compose the
   * effective layout, publish it, and rebind the controller. Guarded by `epoch` so
   * a resolution for a superseded route never wins.
   */
  const resolveAndBind = useCallback(
    async (epoch: number) => {
      const adapter = adapterRef.current;
      const pageType = pageTypeRef.current;
      if (adapter === null || pageType === null) return;
      const [override, org] = await Promise.all([
        adapter.get(scopeKey('user', page)),
        adapter.get(scopeKey({ node: ORG_NODE }, page)),
      ]);
      if (epochRef.current !== epoch) return;
      const composed = composeEffective(pageType, org, override);
      setEffective(composed);
      bindController(composed, page, pageType);
    },
    [page, bindController],
  );

  useEffect(() => {
    const epoch = ++epochRef.current;
    const pageType = resolvePageType(page.pageType);
    pageTypeRef.current = pageType;
    setReady(false);
    setCanEdit(pageType.descriptor.allow_user_customization);
    // Render the default layout immediately so the canvas is never blank while the
    // session and the user's override are fetched (SPEC §7: the shell never blocks).
    setEffective(composeEffective(pageType, undefined, undefined));

    void (async () => {
      try {
        const user = await ensureSession(DEMO_API_BASE);
        if (epochRef.current !== epoch) return;
        adapterRef.current = new ApiLayoutPersistence({ userId: user.id, baseUrl: DEMO_API_BASE });
        await resolveAndBind(epoch);
      } catch {
        // Degraded mode: the demo API is unreachable, so there is no session to
        // persist under. The default layout (set above) still renders; edit mode
        // stays inert because no controller was bound.
      }
      if (epochRef.current !== epoch) return;
      setReady(true);
    })();

    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [page.pageType, page.entityId, resolveAndBind]);

  const enter = useCallback(() => {
    const controller = controllerRef.current;
    if (controller === null) return;
    controller.enter();
    setEditing(controller.editing);
  }, []);

  const save = useCallback(async () => {
    const buffer = bufferRef.current;
    const adapter = adapterRef.current;
    if (buffer !== null && adapter !== null) {
      await buffer.flush(adapter);
    }
    setDirty(false);
    controllerRef.current?.exit();
    setEditing(false);
  }, []);

  const discard = useCallback(async () => {
    bufferRef.current?.clear();
    controllerRef.current?.exit();
    setEditing(false);
    // Re-render whatever is actually persisted, dropping the in-memory edits.
    await resolveAndBind(epochRef.current);
  }, [resolveAndBind]);

  const resetToDefault = useCallback(async () => {
    const adapter = adapterRef.current;
    if (adapter !== null) {
      // Delete only the user override; the default/org document is never written,
      // so this proves copy-on-write — resolution now falls back to it.
      await adapter.delete(scopeKey('user', page));
    }
    bufferRef.current?.clear();
    controllerRef.current?.exit();
    setEditing(false);
    await resolveAndBind(epochRef.current);
  }, [page, resolveAndBind]);

  const session: EditSession = {
    canvasRef,
    effective,
    ready,
    canEdit,
    editing,
    dirty,
    enter,
    save,
    discard,
    resetToDefault,
  };

  return <EditSessionContext.Provider value={session}>{children}</EditSessionContext.Provider>;
}
