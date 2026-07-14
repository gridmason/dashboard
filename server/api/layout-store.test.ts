/**
 * api/layout-store — the layout KV round-trip (FR-5 acceptance): a LayoutDoc
 * written at `(scope|user, pageType, entityId?)` reads back identical, both
 * through the store directly and over the HTTP API, and file backing survives a
 * restart.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LayoutStore } from '../layout-store/index';
import { loginCookie, makeLayoutDoc, startTestServer, type TestServer } from './test-helpers';

describe('api/layout-store', () => {
  describe('LayoutStore (in-memory)', () => {
    it('round-trips a document at (scope|user, pageType, entityId?)', () => {
      const store = new LayoutStore();
      const doc = makeLayoutDoc();
      const key = { scope: 'user:alice', pageType: 'dashboards.home' };
      store.put(key, doc);
      expect(store.get(key)).toEqual(doc);
    });

    it('keys the same pageType distinctly by scope and entityId', () => {
      const store = new LayoutStore();
      const alice = makeLayoutDoc({ name: 'Alice home' });
      const org = makeLayoutDoc({ name: 'Org home' });
      const record = makeLayoutDoc({ name: 'Record 42' });
      store.put({ scope: 'user:alice', pageType: 'dashboards.home' }, alice);
      store.put({ scope: 'org', pageType: 'dashboards.home' }, org);
      store.put({ scope: 'user:alice', pageType: 'crm.customer', entityId: '42' }, record);

      expect(store.get({ scope: 'user:alice', pageType: 'dashboards.home' })).toEqual(alice);
      expect(store.get({ scope: 'org', pageType: 'dashboards.home' })).toEqual(org);
      expect(store.get({ scope: 'user:alice', pageType: 'crm.customer', entityId: '42' })).toEqual(record);
      // The entity-scoped key must not collide with the entity-less one.
      expect(store.get({ scope: 'user:alice', pageType: 'crm.customer' })).toBeUndefined();
    });

    it('isolates stored state from later mutation of the caller\'s object', () => {
      const store = new LayoutStore();
      const doc = makeLayoutDoc();
      const key = { scope: 'user:alice', pageType: 'dashboards.home' };
      store.put(key, doc);
      (doc as { name: string }).name = 'mutated after put';
      expect(store.get(key)?.name).toBe('Home');
    });
  });

  describe('LayoutStore (file-backed)', () => {
    let dir: string;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('persists a document across store instances', () => {
      dir = mkdtempSync(join(tmpdir(), 'gm-layout-'));
      const filePath = join(dir, 'layouts.json');
      const key = { scope: 'user:alice', pageType: 'dashboards.home', entityId: 'x' };
      const doc = makeLayoutDoc({ name: 'Persisted' });

      new LayoutStore({ filePath }).put(key, doc);
      // A fresh instance loads from the same file.
      expect(new LayoutStore({ filePath }).get(key)).toEqual(doc);
    });
  });

  describe('over the HTTP API', () => {
    let server: TestServer;
    afterEach(async () => {
      await server?.close();
    });

    it('PUT then GET returns the identical document', async () => {
      server = await startTestServer();
      const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      const doc = makeLayoutDoc({ name: 'Via HTTP' });
      const path = '/api/layouts/user:alice/dashboards.home';

      const put = await fetch(`${server.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(doc),
      });
      expect(put.status).toBe(200);

      const get = await fetch(`${server.baseUrl}${path}`, { headers: { cookie } });
      expect(get.status).toBe(200);
      expect(await get.json()).toEqual(doc);
    });

    it('rejects a body that is not a valid LayoutDoc', async () => {
      server = await startTestServer();
      const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      const res = await fetch(`${server.baseUrl}/api/layouts/user:alice/dashboards.home`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ not: 'a layout' }),
      });
      expect(res.status).toBe(400);
    });

    it('404s a read of a missing layout', async () => {
      server = await startTestServer();
      const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      const res = await fetch(`${server.baseUrl}/api/layouts/user:alice/never.saved`, {
        headers: { cookie },
      });
      expect(res.status).toBe(404);
    });
  });
});
