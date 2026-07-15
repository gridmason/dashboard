/**
 * The static-demo governance adapter (FR-4, SPEC §5/§6) over an in-memory
 * `Storage`. It stores an org publication (layout + locks) under the org scope,
 * keyed like the persistence adapter, so the serverless governance demo
 * (publish → unpublish) round-trips with no server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScopeKey } from '@gridmason/core/engine';
import { makeLayoutDoc } from '../../../server/api/test-helpers';
import type { OrgPublication } from './api-governance';
import { LocalGovernance } from './local-governance';

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

const ORG_KEY: ScopeKey = { owner: { node: 'org' }, pageType: 'dashboards.home' };

describe('LocalGovernance', () => {
  let storage: Storage;
  let adapter: LocalGovernance;
  beforeEach(() => {
    storage = memoryStorage();
    adapter = new LocalGovernance({ userId: 'alice', storage });
  });

  it('publishes an org layout + locks under the org scope and reads it back identical', async () => {
    const publication: OrgPublication = { layout: makeLayoutDoc({ name: 'Org home' }), locks: ['header'] };

    await adapter.publish(ORG_KEY, publication);

    expect(storage.getItem('gm:demo:governance:org/dashboards.home')).toBe(JSON.stringify(publication));
    expect(await adapter.get(ORG_KEY)).toEqual(publication);
  });

  it('resolves an unpublished page to undefined', async () => {
    expect(await adapter.get(ORG_KEY)).toBeUndefined();
  });

  it('unpublishes and reports whether a publication was present', async () => {
    await adapter.publish(ORG_KEY, { layout: makeLayoutDoc(), locks: [] });

    expect(await adapter.unpublish(ORG_KEY)).toBe(true);
    expect(await adapter.get(ORG_KEY)).toBeUndefined();
    // Idempotent: unpublishing an absent publication is a no-op `false`.
    expect(await adapter.unpublish(ORG_KEY)).toBe(false);
  });
});
