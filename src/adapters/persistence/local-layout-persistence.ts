/**
 * The **static-demo** persistence adapter (docs/SPEC.md §6, FR-5) — the
 * browser-only counterpart of {@link ApiLayoutPersistence}. The serverless build
 * (`npm run build:static-demo`) has no demo API, so a user's copy-on-write layout
 * override is stored in `localStorage` instead of over HTTP.
 *
 * It is a drop-in {@link LayoutPersistenceAdapter}: it implements the same
 * `(get, put, delete)` by {@link ScopeKey} contract, so **everything above it is
 * unchanged** — the 3-level resolution, the buffered copy-on-write edit loop
 * (`../../edit/buffered-persistence`), and reset-to-default all behave exactly as
 * they do against the API. Copy-on-write is preserved for free: the edit layer
 * still writes only the `user:<id>` override through `put` and deletes it on
 * reset, never touching the page-type default (which lives in code) or an org
 * publication (a separate store). That is the whole point of keeping the store
 * behind this narrow port.
 *
 * The store key mirrors the flat `(scope, pageType, entityId?)` the API's KV store
 * uses (SPEC §5): `<namespace>:<scope>/<pageType>[/<entityId>]`, where `scope` is
 * the same `user:<id>` / org-node projection {@link ownerToScope} produces. A
 * corrupt entry (hand-edited storage) reads back as "no override" rather than
 * throwing, so a bad value degrades to the default layout instead of breaking boot.
 */
import type { LayoutPage } from '@gridmason/protocol';
import type { ScopeKey } from '@gridmason/core/engine';
import { ownerToScope, type LayoutPersistenceAdapter } from './api-layout-persistence';

/** The default `localStorage` key namespace for stored demo layouts. */
export const DEFAULT_LAYOUT_NAMESPACE = 'gm:demo:layout';

/** Options for {@link LocalLayoutPersistence}. */
export interface LocalLayoutPersistenceOptions {
  /**
   * The id of the (fixed) demo user, used to spell the `user:<id>` store scope for
   * a `{ owner: 'user' }` key — the same projection the API adapter applies.
   */
  readonly userId: string;
  /**
   * The `Storage` to persist into. Defaults to `globalThis.localStorage` (the
   * browser); a test injects an in-memory `Storage`.
   */
  readonly storage?: Storage;
  /** Key namespace, so demo layouts never collide with other app storage. Defaults to {@link DEFAULT_LAYOUT_NAMESPACE}. */
  readonly namespace?: string;
}

/** The reference `localStorage`-backed {@link LayoutPersistenceAdapter} for the static demo. */
export class LocalLayoutPersistence implements LayoutPersistenceAdapter {
  readonly #userId: string;
  readonly #storage: Storage;
  readonly #namespace: string;

  constructor(options: LocalLayoutPersistenceOptions) {
    this.#userId = options.userId;
    this.#storage = options.storage ?? globalThis.localStorage;
    this.#namespace = options.namespace ?? DEFAULT_LAYOUT_NAMESPACE;
  }

  /** The storage key a {@link ScopeKey} addresses (SPEC §5 key order: scope, pageType, entityId?). */
  #keyFor(key: ScopeKey): string {
    const segments = [ownerToScope(key.owner, this.#userId), key.pageType];
    if (key.entityId !== undefined) segments.push(key.entityId);
    return `${this.#namespace}:${segments.join('/')}`;
  }

  async get(key: ScopeKey): Promise<LayoutPage | undefined> {
    const raw = this.#storage.getItem(this.#keyFor(key));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as LayoutPage;
    } catch {
      // A corrupt (hand-edited) entry degrades to "no override" — the page falls
      // back to the default layout rather than failing to boot.
      return undefined;
    }
  }

  async put(key: ScopeKey, doc: LayoutPage): Promise<void> {
    this.#storage.setItem(this.#keyFor(key), JSON.stringify(doc));
  }

  async delete(key: ScopeKey): Promise<boolean> {
    const storageKey = this.#keyFor(key);
    const existed = this.#storage.getItem(storageKey) !== null;
    this.#storage.removeItem(storageKey);
    return existed;
  }
}
