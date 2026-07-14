/**
 * The reference **governance adapter** (docs/SPEC.md §5/§6, FR-4): an API-backed
 * store for an organization's published layout **and the slots it locks**, keyed
 * `(org-node, pageType, entityId?)`. It is the org-publish sibling of the
 * {@link ApiLayoutPersistence} adapter (which stores a user's copy-on-write
 * override); together they are the two inputs the 3-level resolution composes on
 * top of the page-type default.
 *
 * Why locks live here and not on the layout: `@gridmason/core`'s `resolveLayout`
 * takes each level's `locks` as a separate `readonly string[]` — the org lock-set
 * is deliberately *not* a field on the `LayoutPage` contract. This adapter is the
 * caller that supplies the org level's `{ layout, locks }` pair, read back from
 * the demo API's governance endpoints:
 *
 *   GET    /api/governance/:scope/:pageType[/:entityId]   read an OrgPublication
 *   PUT    /api/governance/:scope/:pageType[/:entityId]   publish (publisher only)
 *   DELETE /api/governance/:scope/:pageType[/:entityId]   unpublish (publisher only)
 *
 * Publishing is a privileged operation: the API enforces the publisher role + the
 * `governance.publish` gate and answers a non-publisher with `403` (SPEC §6 role
 * stub). Reading is open to any session — a user must see what governs them.
 */
import type { LayoutPage } from '@gridmason/protocol';
import type { ScopeKey } from '@gridmason/core/engine';
import { ownerToScope } from '../persistence';

/**
 * An organization's published layout plus the slots it locks (mirrors the demo
 * API's `OrgPublication`). `locks` are slot ids the user level cannot override
 * (SPEC §5); they compose with the page-type's default-level locks at resolution.
 */
export interface OrgPublication {
  /** The org's published layout document. */
  readonly layout: LayoutPage;
  /** Slot ids the org locks for the user level below it. */
  readonly locks: readonly string[];
}

/** Read/publish/unpublish an org publication by its {@link ScopeKey}. */
export interface GovernanceAdapter {
  /** The publication governing `key`, or `undefined` if none is published. */
  get(key: ScopeKey): Promise<OrgPublication | undefined>;
  /** Publish `publication` at `key` (publisher-only; rejects with 403 otherwise). */
  publish(key: ScopeKey, publication: OrgPublication): Promise<void>;
  /** Remove the publication at `key`. Resolves `true` if one was present (publisher-only). */
  unpublish(key: ScopeKey): Promise<boolean>;
}

/** Options for {@link ApiGovernance} (same shape as the persistence adapter's). */
export interface ApiGovernanceOptions {
  /** The signed-in user id, used only to spell a `user:<id>` scope for a user-owned key. */
  readonly userId: string;
  /** Base URL the `/api/...` paths resolve against. Defaults to `''` (same-origin). */
  readonly baseUrl?: string;
  /** Injectable `fetch`, for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Raised when the governance API answers with an unexpected status. Carries the
 * status so a caller can distinguish a `403` (not a publisher) from other errors.
 */
export class GovernanceError extends Error {
  override readonly name = 'GovernanceError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The reference API-backed {@link GovernanceAdapter} (SPEC §6). */
export class ApiGovernance implements GovernanceAdapter {
  readonly #userId: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: ApiGovernanceOptions) {
    this.#userId = options.userId;
    this.#baseUrl = options.baseUrl ?? '';
    this.#fetch = (options.fetch ?? globalThis.fetch).bind(globalThis);
  }

  /** The `/api/governance/...` path a {@link ScopeKey} addresses. */
  #pathFor(key: ScopeKey): string {
    const segments = [ownerToScope(key.owner, this.#userId), key.pageType];
    if (key.entityId !== undefined) segments.push(key.entityId);
    return `${this.#baseUrl}/api/governance/${segments.map(encodeURIComponent).join('/')}`;
  }

  async get(key: ScopeKey): Promise<OrgPublication | undefined> {
    const res = await this.#fetch(this.#pathFor(key), { credentials: 'include' });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new GovernanceError(res.status, `governance GET failed (${res.status})`);
    return (await res.json()) as OrgPublication;
  }

  async publish(key: ScopeKey, publication: OrgPublication): Promise<void> {
    const res = await this.#fetch(this.#pathFor(key), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(publication),
    });
    if (!res.ok) throw new GovernanceError(res.status, `governance PUT failed (${res.status})`);
  }

  async unpublish(key: ScopeKey): Promise<boolean> {
    const res = await this.#fetch(this.#pathFor(key), {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.status === 204) return true;
    if (res.status === 404) return false;
    throw new GovernanceError(res.status, `governance DELETE failed (${res.status})`);
  }
}
