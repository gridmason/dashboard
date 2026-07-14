/**
 * The reference **persistence adapter** (docs/SPEC.md §6, FR-5): an API-backed
 * key-value layout store, keyed `(scope|user, pageType, entityId?)`, that the
 * dashboard reads and writes layouts through. It is the reference documentation
 * for anyone embedding the engine — a host swaps this class for one talking to
 * its own backend and everything above it (3-level resolution, copy-on-write,
 * reset-to-default) is unchanged.
 *
 * It talks to the D-E0.2 demo API's layout endpoints:
 *
 *   GET    /api/layouts/:scope/:pageType[/:entityId]   read a LayoutDoc
 *   PUT    /api/layouts/:scope/:pageType[/:entityId]   write a LayoutDoc
 *   DELETE /api/layouts/:scope/:pageType[/:entityId]   delete a LayoutDoc
 *
 * The engine addresses a stored layout by {@link ScopeKey} — `owner` is `'user'`
 * (the current user) or a named org scope-node. This adapter is the one place
 * that projects that key onto the store's flat `scope` segment: the current user
 * becomes `user:<id>`, an org node becomes its node name (SPEC §5). Keeping the
 * projection here is why the resolution/edit layers never learn the store's key
 * spelling.
 *
 * Core makes **zero** network calls (SPEC §1): the edit controller writes through
 * a {@link LayoutPersistencePort} `put` hop, and this adapter — a superset of that
 * port (it adds `get`/`delete`) — is where the hop becomes an HTTP request.
 */
import type { LayoutPage } from '@gridmason/protocol';
import type { ScopeKey, ScopeOwner } from '@gridmason/core/engine';

/**
 * The host persistence adapter interface (the C-E4 superset of core's
 * {@link LayoutPersistencePort}): read, write, and delete a stored layout by its
 * {@link ScopeKey}. `put` alone satisfies the edit controller's port; the
 * dashboard needs `get` to resolve a user's saved override and `delete` to
 * implement reset-to-default.
 */
export interface LayoutPersistenceAdapter {
  /** The stored layout for `key`, or `undefined` if none is stored there. */
  get(key: ScopeKey): Promise<LayoutPage | undefined>;
  /** Store `doc` at `key`, overwriting any existing document. */
  put(key: ScopeKey, doc: LayoutPage): Promise<void>;
  /** Delete the layout at `key`. Resolves `true` if one was present, else `false`. */
  delete(key: ScopeKey): Promise<boolean>;
}

/** Options for {@link ApiLayoutPersistence}. */
export interface ApiLayoutPersistenceOptions {
  /**
   * The id of the signed-in user, used to spell the `user:<id>` store scope for a
   * `{ owner: 'user' }` key. Comes from the stub-login session (SPEC §1, GW-D21).
   */
  readonly userId: string;
  /**
   * Base URL the `/api/...` paths are resolved against. Defaults to `''` — the
   * app is served same-origin with the demo API (a dev/preview proxy forwards
   * `/api`), so a relative path and the ambient session cookie authenticate the
   * call. Tests point it at an ephemeral server.
   */
  readonly baseUrl?: string;
  /**
   * Injectable `fetch`, for tests. Defaults to the global `fetch`. The browser
   * sends the `HttpOnly` session cookie automatically on a same-origin request;
   * a node test injects a `fetch` that attaches the login cookie.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Raised when the demo API answers a layout request with an unexpected status —
 * anything other than the documented success / not-found codes. Carries the
 * status so a caller can surface it.
 */
export class LayoutPersistenceError extends Error {
  override readonly name = 'LayoutPersistenceError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Map a {@link ScopeOwner} to the store's flat `scope` segment (SPEC §5): the
 * current user is `user:<id>`; a named org node is its node name. Exported for
 * the resolution layer's tests, which assert the key a user override lands under.
 */
export function ownerToScope(owner: ScopeOwner, userId: string): string {
  return owner === 'user' ? `user:${userId}` : owner.node;
}

/** The reference API-backed {@link LayoutPersistenceAdapter} (SPEC §6). */
export class ApiLayoutPersistence implements LayoutPersistenceAdapter {
  readonly #userId: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: ApiLayoutPersistenceOptions) {
    this.#userId = options.userId;
    this.#baseUrl = options.baseUrl ?? '';
    // Bind so an injected `fetch` (or the global) keeps its receiver.
    this.#fetch = (options.fetch ?? globalThis.fetch).bind(globalThis);
  }

  /** The `/api/layouts/...` path a {@link ScopeKey} addresses (SPEC §5 key order). */
  #pathFor(key: ScopeKey): string {
    const segments = [ownerToScope(key.owner, this.#userId), key.pageType];
    if (key.entityId !== undefined) segments.push(key.entityId);
    return `${this.#baseUrl}/api/layouts/${segments.map(encodeURIComponent).join('/')}`;
  }

  async get(key: ScopeKey): Promise<LayoutPage | undefined> {
    const res = await this.#fetch(this.#pathFor(key), { credentials: 'include' });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new LayoutPersistenceError(res.status, `layout GET failed (${res.status})`);
    return (await res.json()) as LayoutPage;
  }

  async put(key: ScopeKey, doc: LayoutPage): Promise<void> {
    const res = await this.#fetch(this.#pathFor(key), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new LayoutPersistenceError(res.status, `layout PUT failed (${res.status})`);
  }

  async delete(key: ScopeKey): Promise<boolean> {
    const res = await this.#fetch(this.#pathFor(key), {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.status === 204) return true;
    if (res.status === 404) return false;
    throw new LayoutPersistenceError(res.status, `layout DELETE failed (${res.status})`);
  }
}
