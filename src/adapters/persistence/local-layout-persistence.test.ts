/**
 * The static-demo persistence adapter (FR-5, SPEC §6) over an in-memory `Storage`.
 * It must key layouts exactly as the API adapter's store does — a `{ owner: 'user' }`
 * write lands at store scope `user:<id>`, an entity-scoped key never collides with
 * the entity-less one, and a user write never touches the org scope — so the
 * copy-on-write edit loop behaves identically with no server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScopeKey } from '@gridmason/core/engine';
import { makeLayoutDoc } from '../../../server/api/test-helpers';
import { LocalLayoutPersistence } from './local-layout-persistence';

/** A minimal synchronous in-memory `Storage` for the adapter under test. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('LocalLayoutPersistence', () => {
  let storage: Storage;
  let adapter: LocalLayoutPersistence;
  beforeEach(() => {
    storage = memoryStorage();
    adapter = new LocalLayoutPersistence({ userId: 'alice', storage });
  });

  it('writes a user key under `<namespace>:user:<id>/<pageType>` and reads it back identical', async () => {
    const doc = makeLayoutDoc({ name: 'Alice home' });
    const key: ScopeKey = { owner: 'user', pageType: 'dashboards.home' };

    await adapter.put(key, doc);

    // Verified against the raw store key (the copy-on-write override lands at user scope).
    expect(storage.getItem('gm:demo:layout:user:alice/dashboards.home')).toBe(JSON.stringify(doc));
    expect(await adapter.get(key)).toEqual(doc);
  });

  it('keys an entity-scoped layout distinctly from the entity-less one', async () => {
    const record = makeLayoutDoc({ name: 'Record 42' });
    const key: ScopeKey = { owner: 'user', pageType: 'demo.record-detail', entityId: 'cust-42' };

    await adapter.put(key, record);

    expect(storage.getItem('gm:demo:layout:user:alice/demo.record-detail/cust-42')).toBe(
      JSON.stringify(record),
    );
    // The entity-less key must not resolve the entity-scoped document.
    expect(await adapter.get({ owner: 'user', pageType: 'demo.record-detail' })).toBeUndefined();
  });

  it('never touches the org scope when a user writes their override', async () => {
    const org = makeLayoutDoc({ name: 'Org home' });
    storage.setItem('gm:demo:layout:org/dashboards.home', JSON.stringify(org));

    await adapter.put({ owner: 'user', pageType: 'dashboards.home' }, makeLayoutDoc({ name: 'User home' }));

    // The org (default) document is untouched — copy-on-write's core invariant.
    expect(storage.getItem('gm:demo:layout:org/dashboards.home')).toBe(JSON.stringify(org));
  });

  it('resolves a missing layout to undefined', async () => {
    expect(await adapter.get({ owner: 'user', pageType: 'never.saved' })).toBeUndefined();
  });

  it('degrades a corrupt stored entry to undefined rather than throwing', async () => {
    storage.setItem('gm:demo:layout:user:alice/dashboards.home', '{ not valid json');
    expect(await adapter.get({ owner: 'user', pageType: 'dashboards.home' })).toBeUndefined();
  });

  it('deletes a user override and reports whether one was present', async () => {
    const key: ScopeKey = { owner: 'user', pageType: 'dashboards.home' };
    await adapter.put(key, makeLayoutDoc());

    expect(await adapter.delete(key)).toBe(true);
    expect(await adapter.get(key)).toBeUndefined();
    // Reset-to-default is idempotent: deleting an absent override is a no-op `false`.
    expect(await adapter.delete(key)).toBe(false);
  });

  it('projects an org scope-node to its node name (no `user:` prefix)', async () => {
    const doc = makeLayoutDoc();
    await adapter.put({ owner: { node: 'org' }, pageType: 'dashboards.home' }, doc);
    expect(storage.getItem('gm:demo:layout:org/dashboards.home')).toBe(JSON.stringify(doc));
  });
});
