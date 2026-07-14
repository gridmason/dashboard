/**
 * The reference persistence adapter over the real demo API (FR-5, SPEC §6). Each
 * case boots the D-E0.2 service on an ephemeral port and drives the adapter over
 * HTTP, asserting the {@link ScopeKey} → store-key projection **against the KV
 * store itself** (the acceptance criterion): a `{ owner: 'user' }` write must land
 * at store scope `user:<id>`, an entity-scoped key must not collide with the
 * entity-less one, and a user write must never touch the org scope.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ScopeKey } from '@gridmason/core/engine';
import {
  loginCookie,
  makeLayoutDoc,
  startTestServer,
  type TestServer,
} from '../../../server/api/test-helpers';
import { ApiLayoutPersistence, ownerToScope } from './api-layout-persistence';

/** A `fetch` that attaches the stub-login cookie the browser would send automatically. */
function fetchWithCookie(cookie: string): typeof globalThis.fetch {
  return (input, init = {}) =>
    globalThis.fetch(input, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), cookie },
    });
}

async function adapterFor(server: TestServer, userId = 'alice'): Promise<ApiLayoutPersistence> {
  const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
  return new ApiLayoutPersistence({ userId, baseUrl: server.baseUrl, fetch: fetchWithCookie(cookie) });
}

describe('ownerToScope', () => {
  it('projects the current user to the `user:<id>` store scope', () => {
    expect(ownerToScope('user', 'alice')).toBe('user:alice');
  });

  it('projects an org scope-node to its node name', () => {
    expect(ownerToScope({ node: 'org' }, 'alice')).toBe('org');
  });
});

describe('ApiLayoutPersistence', () => {
  let server: TestServer;
  afterEach(async () => {
    await server?.close();
  });

  it('writes a user key to store scope `user:<id>` and reads it back identical', async () => {
    server = await startTestServer();
    const adapter = await adapterFor(server);
    const doc = makeLayoutDoc({ name: 'Alice home' });
    const key: ScopeKey = { owner: 'user', pageType: 'dashboards.home' };

    await adapter.put(key, doc);

    // Verified against the KV store: the adapter landed the doc at `user:alice`.
    expect(server.store.get({ scope: 'user:alice', pageType: 'dashboards.home' })).toEqual(doc);
    expect(await adapter.get(key)).toEqual(doc);
  });

  it('keys an entity-scoped layout distinctly from the entity-less one', async () => {
    server = await startTestServer();
    const adapter = await adapterFor(server);
    const record = makeLayoutDoc({ name: 'Record 42' });
    const key: ScopeKey = { owner: 'user', pageType: 'demo.record-detail', entityId: 'cust-42' };

    await adapter.put(key, record);

    expect(server.store.get({ scope: 'user:alice', pageType: 'demo.record-detail', entityId: 'cust-42' })).toEqual(record);
    // The entity-less key must not resolve the entity-scoped document.
    expect(await adapter.get({ owner: 'user', pageType: 'demo.record-detail' })).toBeUndefined();
  });

  it('never touches the org scope when a user writes their override', async () => {
    server = await startTestServer();
    const adapter = await adapterFor(server);
    const org = makeLayoutDoc({ name: 'Org home' });
    server.store.put({ scope: 'org', pageType: 'dashboards.home' }, org);

    await adapter.put({ owner: 'user', pageType: 'dashboards.home' }, makeLayoutDoc({ name: 'User home' }));

    // The org (default) document is untouched — copy-on-write's core invariant.
    expect(server.store.get({ scope: 'org', pageType: 'dashboards.home' })).toEqual(org);
  });

  it('resolves a missing layout to undefined', async () => {
    server = await startTestServer();
    const adapter = await adapterFor(server);
    expect(await adapter.get({ owner: 'user', pageType: 'never.saved' })).toBeUndefined();
  });

  it('deletes a user override and reports whether one was present', async () => {
    server = await startTestServer();
    const adapter = await adapterFor(server);
    const key: ScopeKey = { owner: 'user', pageType: 'dashboards.home' };
    await adapter.put(key, makeLayoutDoc());

    expect(await adapter.delete(key)).toBe(true);
    expect(await adapter.get(key)).toBeUndefined();
    // Reset-to-default is idempotent: deleting an absent override is a no-op `false`.
    expect(await adapter.delete(key)).toBe(false);
  });
});
