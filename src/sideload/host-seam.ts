/**
 * The dev-sideload **seam** the canvas render path consults (docs/SPEC.md §4).
 *
 * `CanvasHost` sits on the shared, production render path, so it must not
 * statically import the dev-only sideload subtree (store, UI, dev-server URLs) —
 * that would pull dev code into the production bundle. Instead it talks to this
 * tiny, prod-safe holder: the dev-only {@link DevSideloadProvider} **installs** a
 * {@link SideloadHost} into it (only ever under `import.meta.env.DEV`), and
 * `CanvasHost` reads it back — also behind an `import.meta.env.DEV` guard, so in a
 * production build the guard is statically `false`, the seam calls are dead code,
 * and nothing here is retained (see `production-gate.test.ts`).
 *
 * The seam carries exactly what the render path needs and nothing dev-specific in
 * its own code: the sideload import-map entries to merge, a display-name resolver
 * for sideloaded cards, and the identity of a placed instance the dev picker
 * added this session (so a not-yet-persisted sideload widget still gets its badge
 * and interim SDK handle — `effective` won't list it until a reload re-resolves
 * the saved layout).
 */
import type { WidgetID } from '@gridmason/protocol';
import type { LocalRemote } from '../boot/import-map';
import type { DevReloadCategory } from './dev-events';

/** What the dev-only provider exposes to the canvas render path. */
export interface SideloadHost {
  /** The admitted dev-sideload remotes, as import-map entries to merge with the local map. */
  remotes(): readonly LocalRemote[];
  /** A display name for a sideloaded widget identity (its card/fallback name), or `undefined`. */
  describe(id: WidgetID): string | undefined;
  /**
   * The identity of a placed instance the dev picker added this session, or
   * `undefined`. Bridges the window before a Save re-resolves `effective`: the
   * canvas learns a live-added sideload instance's `(source, tag)` for its badge
   * and interim handle without waiting on React state.
   */
  widgetIdForInstance(instanceId: string): WidgetID | undefined;
}

let installed: SideloadHost | null = null;

/** Install (or clear, with `null`) the dev-sideload host. Called only by the dev-only provider. */
export function installSideloadHost(host: SideloadHost | null): void {
  installed = host;
}

/** The installed dev-sideload host, or `null` when dev sideload is not active. */
export function sideloadHost(): SideloadHost | null {
  return installed;
}

/**
 * The **acknowledged-sideload** seam (docs/SPEC.md §4, FR-8). Independent of the
 * dev seam above and, unlike it, **prod-safe**: acknowledged sideload is available
 * in production builds (SPEC §4 restricts only `dev` to dev builds), so the
 * canvas render path consults this one on **every** build, not behind an
 * `import.meta.env.DEV` guard. The always-on `AcknowledgedSideloadProvider`
 * installs it; `CanvasHost` reads it back to merge acknowledged remotes into the
 * import map and to badge acknowledged cards distinctly from dev ones.
 */
let acknowledgedInstalled: SideloadHost | null = null;

/** Install (or clear, with `null`) the acknowledged-sideload host. Called by the always-on provider. */
export function installAcknowledgedSideloadHost(host: SideloadHost | null): void {
  acknowledgedInstalled = host;
}

/** The installed acknowledged-sideload host, or `null` when none is active. */
export function acknowledgedSideloadHost(): SideloadHost | null {
  return acknowledgedInstalled;
}

/**
 * A dev-server hot-reload notification (docs/SPEC.md §4, FR-7, issue #41): one
 * admitted dev origin's widget was re-served and its live instances should be
 * remounted. `tag` addresses the placed instances; `category`/`generation` carry
 * the `gridmason dev` reload frame for observability.
 */
export interface DevReloadSignal {
  /** The dev-server origin whose widget was re-served. */
  readonly origin: string;
  /** The custom-element tag of the re-served widget (the instances to remount). */
  readonly tag: string;
  /** The reload category the edit fell into (`source`/`manifest`/`fixtures`/`context`). */
  readonly category: DevReloadCategory;
  /** The cache-busting generation token from the reload frame. */
  readonly generation: number;
}

/**
 * The dev hot-reload **signal bus** — a second, push-shaped seam between the
 * dev-only {@link DevSideloadProvider} (which owns the SSE streams and publishes)
 * and the prod-safe `CanvasHost` (which subscribes and remounts). It is a
 * module-level emitter rather than an install/read holder so a subscriber never
 * races the publisher's installation (a child's effect runs before its parent's):
 * the bus always exists, and in a production build nothing ever publishes to it —
 * `CanvasHost` subscribes only under `import.meta.env.DEV`, so the listener set
 * stays empty and this is inert (a handful of dead-code lines, like the seams
 * above; `production-gate.test.ts`).
 */
const devReloadListeners = new Set<(signal: DevReloadSignal) => void>();

/** Notify every subscriber of a dev hot-reload. Called only by the dev-only provider. */
export function publishDevReload(signal: DevReloadSignal): void {
  for (const listener of devReloadListeners) listener(signal);
}

/** Subscribe to dev hot-reload signals; returns an unsubscribe. */
export function subscribeDevReload(listener: (signal: DevReloadSignal) => void): () => void {
  devReloadListeners.add(listener);
  return () => {
    devReloadListeners.delete(listener);
  };
}
