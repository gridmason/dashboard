/**
 * The per-session dev-sideload allowlist (docs/SPEC.md §4, FR-7).
 *
 * `dev` mode adds local dev-server remotes on a **per-session allowlist, nothing
 * persisted**. This store is that allowlist: a plain in-memory registry of the
 * dev-server remotes the owner has admitted this session. It writes to **no**
 * durable store — no `localStorage`, no cookie, no config write — so a reload or
 * a new session starts empty (proven in `allowlist-store.test.ts` and the
 * session-scope e2e). The whole store is reached only under `import.meta.env.DEV`
 * (see `./index`), so a production build never carries it.
 *
 * ## Extension seam (#12, acknowledged sideload)
 *
 * The sibling issue #12 (acknowledged sideload) layers a **persistent**,
 * owner-acknowledged allowlist registered **by URL** with a **hash pin** on top
 * of this same shape. To make that additive, {@link DevSideloadRemote} already
 * carries the registration `origin` + `entryUrl` a URL registration needs and
 * leaves room for a `hashPin`, and this store isolates *storage* behind one class
 * so #12 can add a persisted backing (config-recorded) as a sibling without
 * reworking the dev path. This class stays **memory-only by contract**.
 */
import { sideloadSource } from './source';
import type { WidgetID } from '@gridmason/protocol';

/**
 * One admitted dev-server remote: the dev-server `origin` it was registered from,
 * the ES-module `entryUrl` the dashboard imports to register its custom element,
 * the widget `tag` that entry defines, and a human `name` for the card/picker.
 * Its {@link widgetID} is the `sideload:<origin>` identity every placed instance
 * and badge keys on.
 */
export interface DevSideloadRemote {
  /** The dev-server origin the remote was registered from (e.g. `http://localhost:6070`). */
  readonly origin: string;
  /** Absolute URL of the ES-module entry to `import()` (registers the custom element). */
  readonly entryUrl: string;
  /** The custom-element tag the entry defines (publisher-prefixed, lowercase). */
  readonly tag: string;
  /** Human display name for the card + picker entry. */
  readonly name: string;
  /** The source-qualified `sideload:<origin>` identity of this remote. */
  readonly widgetID: WidgetID;
  /**
   * Reserved for #12 (acknowledged sideload): the content hash a persisted
   * registration pins the remote to. Unused on the `dev` path — a dev remote is
   * re-served live and never hash-pinned — but declared so the record shape is
   * shared with the acknowledged path rather than forked.
   */
  readonly hashPin?: string;
}

/** The fields a caller supplies to admit a remote; the store derives {@link DevSideloadRemote.widgetID}. */
export type DevSideloadRegistration = Omit<DevSideloadRemote, 'widgetID'>;

/** A change listener, invoked after every mutation. */
export type AllowlistListener = () => void;

/**
 * The in-memory, session-scoped dev-sideload allowlist. Keyed by `origin` so
 * re-registering a hot-reloaded remote from the same dev server **replaces** its
 * entry rather than duplicating it (the author loop re-serves from one origin).
 * Exposes a `subscribe`/`snapshot` pair shaped for React's `useSyncExternalStore`.
 */
export class DevSideloadAllowlist {
  readonly #byOrigin = new Map<string, DevSideloadRemote>();
  readonly #listeners = new Set<AllowlistListener>();
  /** A new array identity is published on every mutation so `useSyncExternalStore` re-renders. */
  #snapshot: readonly DevSideloadRemote[] = [];

  /**
   * Admit (or replace) the remote registered from `input.origin`, deriving its
   * `sideload:<origin>` identity. Returns the stored record. Replacing an origin
   * is how a re-served remote updates in place (same origin, possibly new entry).
   */
  register(input: DevSideloadRegistration): DevSideloadRemote {
    const remote: DevSideloadRemote = {
      ...input,
      widgetID: { source: sideloadSource(input.origin), tag: input.tag },
    };
    this.#byOrigin.set(input.origin, remote);
    this.#publish();
    return remote;
  }

  /** Remove the remote registered from `origin`. Returns whether one was present. */
  remove(origin: string): boolean {
    const had = this.#byOrigin.delete(origin);
    if (had) this.#publish();
    return had;
  }

  /** Drop every admitted remote (e.g. when the owner re-locks the dev gate). */
  clear(): void {
    if (this.#byOrigin.size === 0) return;
    this.#byOrigin.clear();
    this.#publish();
  }

  /** The admitted remote registered from `origin`, or `undefined`. */
  get(origin: string): DevSideloadRemote | undefined {
    return this.#byOrigin.get(origin);
  }

  /** The admitted remote whose entry defines `tag`, or `undefined` — the mount/badge lookup. */
  byTag(tag: string): DevSideloadRemote | undefined {
    for (const remote of this.#byOrigin.values()) {
      if (remote.tag === tag) return remote;
    }
    return undefined;
  }

  /** The dev-server origins currently admitted — the input the CSP layer permits. */
  origins(): readonly string[] {
    return this.#snapshot.map((remote) => remote.origin);
  }

  /** A stable-until-mutated snapshot of the admitted remotes (for `useSyncExternalStore`). */
  snapshot(): readonly DevSideloadRemote[] {
    return this.#snapshot;
  }

  /** Subscribe to mutations; returns an unsubscribe. */
  subscribe(listener: AllowlistListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #publish(): void {
    this.#snapshot = [...this.#byOrigin.values()];
    for (const listener of this.#listeners) listener();
  }
}
