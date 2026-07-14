/**
 * api/governance-store — the org-publication round-trip and its privileged
 * publish gate (FR-4). A publication (`{ layout, locks }`) written at
 * `(scope, pageType, entityId?)` reads back identical, both through the store and
 * over the HTTP API; publishing is refused for a non-publisher or a disabled
 * gate, while any authenticated user may read the publication that governs them.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GovernanceStore, isOrgPublication, type OrgPublication } from '../governance-store/index';
import { loginCookie, makeConfig, makeLayoutDoc, startTestServer, type TestServer } from './test-helpers';

/** A valid publication: a current-schema layout plus a locked slot. */
function makePublication(overrides: Partial<OrgPublication> = {}): OrgPublication {
  return {
    layout: makeLayoutDoc({ name: 'Org standard', default: false }),
    locks: ['header'],
    ...overrides,
  };
}

describe('api/governance-store', () => {
  describe('GovernanceStore (in-memory)', () => {
    it('round-trips a publication at (scope, pageType, entityId?)', () => {
      const store = new GovernanceStore();
      const publication = makePublication();
      const key = { scope: 'org', pageType: 'demo.record-detail' };
      store.put(key, publication);
      expect(store.get(key)).toEqual(publication);
    });

    it('keys the same pageType distinctly by scope and entityId', () => {
      const store = new GovernanceStore();
      const org = makePublication({ locks: ['header'] });
      const scoped = makePublication({ locks: ['header', 'metrics'] });
      store.put({ scope: 'org', pageType: 'demo.record-detail' }, org);
      store.put({ scope: 'org', pageType: 'demo.record-detail', entityId: 'cust-42' }, scoped);

      expect(store.get({ scope: 'org', pageType: 'demo.record-detail' })).toEqual(org);
      expect(store.get({ scope: 'org', pageType: 'demo.record-detail', entityId: 'cust-42' })).toEqual(scoped);
    });

    it('isolates stored state from later mutation of the caller\'s object', () => {
      const store = new GovernanceStore();
      const publication = makePublication();
      const key = { scope: 'org', pageType: 'demo.record-detail' };
      store.put(key, publication);
      (publication.locks as string[]).push('metrics');
      expect(store.get(key)?.locks).toEqual(['header']);
    });

    it('deletes a publication and reports whether one was present', () => {
      const store = new GovernanceStore();
      const key = { scope: 'org', pageType: 'demo.record-detail' };
      expect(store.delete(key)).toBe(false);
      store.put(key, makePublication());
      expect(store.delete(key)).toBe(true);
      expect(store.get(key)).toBeUndefined();
    });
  });

  describe('GovernanceStore (file-backed)', () => {
    let dir: string;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('persists a publication across store instances', () => {
      dir = mkdtempSync(join(tmpdir(), 'gm-gov-'));
      const filePath = join(dir, 'governance.json');
      const key = { scope: 'org', pageType: 'demo.record-detail', entityId: 'x' };
      const publication = makePublication({ locks: ['header', 'metrics'] });

      new GovernanceStore({ filePath }).put(key, publication);
      expect(new GovernanceStore({ filePath }).get(key)).toEqual(publication);
    });
  });

  describe('isOrgPublication', () => {
    it('accepts a well-formed envelope and rejects malformed ones', () => {
      expect(isOrgPublication(makePublication())).toBe(true);
      expect(isOrgPublication({ layout: {}, locks: [] })).toBe(true);
      expect(isOrgPublication({ layout: {}, locks: ['ok', 3] })).toBe(false);
      expect(isOrgPublication({ layout: null, locks: [] })).toBe(false);
      expect(isOrgPublication({ locks: [] })).toBe(false);
      expect(isOrgPublication(null)).toBe(false);
    });
  });

  describe('over the HTTP API', () => {
    let server: TestServer;
    const path = '/api/governance/org/demo.record-detail';
    afterEach(async () => {
      await server?.close();
    });

    it('an admin publishes; then any user can read the publication', async () => {
      server = await startTestServer();
      const adminCookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      const publication = makePublication({ locks: ['header', 'metrics'] });

      const put = await fetch(`${server.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify(publication),
      });
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual(publication);

      // A non-admin member may read the publication that governs their page.
      const memberCookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
      const get = await fetch(`${server.baseUrl}${path}`, { headers: { cookie: memberCookie } });
      expect(get.status).toBe(200);
      expect(await get.json()).toEqual(publication);
    });

    it('refuses publishing to a non-publisher role (403)', async () => {
      server = await startTestServer();
      const memberCookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
      const res = await fetch(`${server.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: memberCookie },
        body: JSON.stringify(makePublication()),
      });
      expect(res.status).toBe(403);
      expect(server.governance.get({ scope: 'org', pageType: 'demo.record-detail' })).toBeUndefined();
    });

    it('refuses publishing when the governance.publish gate is off (403)', async () => {
      server = await startTestServer({ ...makeConfig(), gates: { 'governance.publish': false } });
      const adminCookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      const res = await fetch(`${server.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify(makePublication()),
      });
      expect(res.status).toBe(403);
    });

    it('rejects a body that is not a valid publication (400)', async () => {
      server = await startTestServer();
      const adminCookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      const res = await fetch(`${server.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        // A valid envelope but an invalid inner layout must still be rejected.
        body: JSON.stringify({ layout: { not: 'a layout' }, locks: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('404s a read of a missing publication', async () => {
      server = await startTestServer();
      const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      const res = await fetch(`${server.baseUrl}/api/governance/org/never.published`, {
        headers: { cookie },
      });
      expect(res.status).toBe(404);
    });

    it('an admin unpublishes (204), and a non-admin cannot (403)', async () => {
      server = await startTestServer();
      const adminCookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      await fetch(`${server.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify(makePublication()),
      });

      const memberCookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
      const forbidden = await fetch(`${server.baseUrl}${path}`, {
        method: 'DELETE',
        headers: { cookie: memberCookie },
      });
      expect(forbidden.status).toBe(403);

      const del = await fetch(`${server.baseUrl}${path}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      });
      expect(del.status).toBe(204);
      expect(server.governance.get({ scope: 'org', pageType: 'demo.record-detail' })).toBeUndefined();
    });

    it('rejects an unauthenticated read (401)', async () => {
      server = await startTestServer();
      const res = await fetch(`${server.baseUrl}${path}`);
      expect(res.status).toBe(401);
    });
  });
});
