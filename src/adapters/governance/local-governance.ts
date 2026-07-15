/**
 * The **static-demo** governance adapter (docs/SPEC.md §5/§6, FR-4) — the
 * browser-only counterpart of {@link ApiGovernance}. The serverless build stores
 * an org's published layout + locks in `localStorage` instead of over HTTP, so the
 * governance demo (publish → the org layout and its locks take effect → unpublish)
 * works with no server.
 *
 * It is a drop-in {@link GovernanceAdapter}: same `(get, publish, unpublish)` by
 * {@link ScopeKey} contract, keyed the same flat `(scope, pageType, entityId?)`
 * way as {@link LocalLayoutPersistence}, under a distinct namespace. Unlike the
 * API adapter it enforces no publisher role — the demo signs the user in as a
 * publisher (`admin`) and the UI's own `canPublish` gate already governs the
 * action; there is no privileged server to answer `403`, so the store just records
 * the publish.
 */
import type { ScopeKey } from '@gridmason/core/engine';
import { ownerToScope } from '../persistence';
import type { GovernanceAdapter, OrgPublication } from './api-governance';

/** The default `localStorage` key namespace for stored demo org publications. */
export const DEFAULT_GOVERNANCE_NAMESPACE = 'gm:demo:governance';

/** Options for {@link LocalGovernance} (same shape as {@link LocalLayoutPersistence}). */
export interface LocalGovernanceOptions {
  /** The (fixed) demo user id, used only to spell a `user:<id>` scope for a user-owned key. */
  readonly userId: string;
  /** The `Storage` to persist into. Defaults to `globalThis.localStorage`; a test injects one. */
  readonly storage?: Storage;
  /** Key namespace. Defaults to {@link DEFAULT_GOVERNANCE_NAMESPACE}. */
  readonly namespace?: string;
}

/** The reference `localStorage`-backed {@link GovernanceAdapter} for the static demo. */
export class LocalGovernance implements GovernanceAdapter {
  readonly #userId: string;
  readonly #storage: Storage;
  readonly #namespace: string;

  constructor(options: LocalGovernanceOptions) {
    this.#userId = options.userId;
    this.#storage = options.storage ?? globalThis.localStorage;
    this.#namespace = options.namespace ?? DEFAULT_GOVERNANCE_NAMESPACE;
  }

  /** The storage key a {@link ScopeKey} addresses. */
  #keyFor(key: ScopeKey): string {
    const segments = [ownerToScope(key.owner, this.#userId), key.pageType];
    if (key.entityId !== undefined) segments.push(key.entityId);
    return `${this.#namespace}:${segments.join('/')}`;
  }

  async get(key: ScopeKey): Promise<OrgPublication | undefined> {
    const raw = this.#storage.getItem(this.#keyFor(key));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as OrgPublication;
    } catch {
      return undefined;
    }
  }

  async publish(key: ScopeKey, publication: OrgPublication): Promise<void> {
    this.#storage.setItem(this.#keyFor(key), JSON.stringify(publication));
  }

  async unpublish(key: ScopeKey): Promise<boolean> {
    const storageKey = this.#keyFor(key);
    const existed = this.#storage.getItem(storageKey) !== null;
    this.#storage.removeItem(storageKey);
    return existed;
  }
}
