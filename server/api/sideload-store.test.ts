/**
 * api/sideload-store — the acknowledged-sideload registration round-trip and its
 * privileged, URL-only registration gate (FR-8, SPEC §4). A registration
 * (`{ url, hash, acknowledgedBy, at }`) written by an owner reads back over the
 * HTTP API and survives a store restart (persistent — the contrast with `dev`
 * sideload's session-only allowlist); registering is refused for a non-owner,
 * inline/base64 code is refused (URL-only), and a malformed hash pin is rejected.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acknowledgedScriptSrc,
  parseRegistrationInput,
  SideloadRegistrationStore,
  type SideloadRegistration,
} from '../sideload-store/index';
import { loginCookie, startTestServer, type TestServer } from './test-helpers';

const REMOTE_URL = 'https://widgets.internal.acme/notes/gridmason.widget.json';
const PIN = 'sha256-abc123def456ghijklmnopqrstuvwxyz0123456789ABCDEF=';

describe('api/sideload-store', () => {
  describe('parseRegistrationInput (URL-only + hash validation)', () => {
    it('accepts an http(s) URL with an SRI sha256 pin and derives the origin', () => {
      const parsed = parseRegistrationInput({ url: REMOTE_URL, hash: PIN, acknowledgedBy: 'alice' });
      expect(parsed).toEqual({
        ok: true,
        value: { url: REMOTE_URL, origin: 'https://widgets.internal.acme', hash: PIN, acknowledgedBy: 'alice' },
      });
    });

    it('rejects inline/base64 code (a data: URL is not URL-registered)', () => {
      const parsed = parseRegistrationInput({
        url: 'data:text/javascript;base64,ZXhwb3J0IHt9',
        hash: PIN,
        acknowledgedBy: 'alice',
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toMatch(/http\(s\)/);
    });

    it('rejects a javascript: pseudo-URL', () => {
      const parsed = parseRegistrationInput({ url: 'javascript:alert(1)', hash: PIN, acknowledgedBy: 'alice' });
      expect(parsed.ok).toBe(false);
    });

    it('rejects a hash that is not an SRI sha256 pin', () => {
      const parsed = parseRegistrationInput({ url: REMOTE_URL, hash: 'deadbeef', acknowledgedBy: 'alice' });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toMatch(/sha256/);
    });

    it('rejects a missing owner acknowledgement', () => {
      const parsed = parseRegistrationInput({ url: REMOTE_URL, hash: PIN });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toMatch(/acknowledgedBy/);
    });
  });

  describe('acknowledgedScriptSrc (config-recorded CSP authority — off by default)', () => {
    const registrations: SideloadRegistration[] = [
      { url: REMOTE_URL, origin: 'https://widgets.internal.acme', hash: PIN, acknowledgedBy: 'alice', at: '2026-07-14T00:00:00.000Z' },
      { url: 'https://other.example/w/gridmason.widget.json', origin: 'https://other.example', hash: PIN, acknowledgedBy: 'alice', at: '2026-07-14T00:00:00.000Z' },
    ];

    it('permits no origin under the default off posture', () => {
      expect(acknowledgedScriptSrc('off', registrations)).toEqual([]);
    });

    it('permits no origin under dev (its relaxation is delivered dev-only, elsewhere)', () => {
      expect(acknowledgedScriptSrc('dev', registrations)).toEqual([]);
    });

    it('permits each registered origin, de-duplicated, only under acknowledged', () => {
      const dupe: SideloadRegistration = {
        url: 'https://widgets.internal.acme/other/gridmason.widget.json',
        origin: 'https://widgets.internal.acme',
        hash: PIN,
        acknowledgedBy: 'alice',
        at: '2026-07-14T00:00:00.000Z',
      };
      expect(acknowledgedScriptSrc('acknowledged', [...registrations, dupe])).toEqual([
        'https://widgets.internal.acme',
        'https://other.example',
      ]);
    });

    it('permits nothing when acknowledged mode is on but no remote is registered', () => {
      expect(acknowledgedScriptSrc('acknowledged', [])).toEqual([]);
    });
  });

  describe('SideloadRegistrationStore (in-memory)', () => {
    it('round-trips a registration keyed by url and stamps `at`', () => {
      const store = new SideloadRegistrationStore();
      const stored = store.put({ url: REMOTE_URL, origin: 'https://widgets.internal.acme', hash: PIN, acknowledgedBy: 'alice' });
      expect(stored.at).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(store.get(REMOTE_URL)).toEqual(stored);
      expect(store.list()).toEqual([stored]);
    });

    it('replaces the pin when the same url is re-registered', () => {
      const store = new SideloadRegistrationStore();
      store.put({ url: REMOTE_URL, origin: 'https://widgets.internal.acme', hash: PIN, acknowledgedBy: 'alice' });
      const next = store.put({ url: REMOTE_URL, origin: 'https://widgets.internal.acme', hash: 'sha256-Zm9v', acknowledgedBy: 'alice' });
      expect(store.size).toBe(1);
      expect(store.get(REMOTE_URL)?.hash).toBe(next.hash);
    });

    it('deletes a registration and reports whether one was present', () => {
      const store = new SideloadRegistrationStore();
      expect(store.delete(REMOTE_URL)).toBe(false);
      store.put({ url: REMOTE_URL, origin: 'https://widgets.internal.acme', hash: PIN, acknowledgedBy: 'alice' });
      expect(store.delete(REMOTE_URL)).toBe(true);
      expect(store.get(REMOTE_URL)).toBeUndefined();
    });
  });

  describe('SideloadRegistrationStore (file-backed)', () => {
    let dir: string;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('persists a registration across store instances (survives restart)', () => {
      dir = mkdtempSync(join(tmpdir(), 'gm-sideload-'));
      const filePath = join(dir, 'sideload.json');
      const first = new SideloadRegistrationStore({ filePath });
      first.put({ url: REMOTE_URL, origin: 'https://widgets.internal.acme', hash: PIN, acknowledgedBy: 'alice' });

      const reopened = new SideloadRegistrationStore({ filePath });
      expect(reopened.get(REMOTE_URL)?.hash).toBe(PIN);
    });
  });

  describe('over the HTTP API', () => {
    let server: TestServer;
    afterEach(() => server?.close());

    it('registers by URL (owner), lists it, and records the session user as acknowledgedBy', async () => {
      server = await startTestServer();
      const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');

      const post = await fetch(`${server.baseUrl}/api/sideload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        // `acknowledgedBy` in the body is ignored — the server uses the session user.
        body: JSON.stringify({ url: REMOTE_URL, hash: PIN, acknowledgedBy: 'someone-else' }),
      });
      expect(post.status).toBe(201);
      const { registration } = (await post.json()) as { registration: { acknowledgedBy: string; origin: string } };
      expect(registration.acknowledgedBy).toBe('alice');
      expect(registration.origin).toBe('https://widgets.internal.acme');
      // Mirrored server-side.
      expect(server.sideload.get(REMOTE_URL)?.acknowledgedBy).toBe('alice');

      const list = await fetch(`${server.baseUrl}/api/sideload`, { headers: { cookie } });
      const body = (await list.json()) as { registrations: { url: string }[] };
      expect(body.registrations.map((r) => r.url)).toEqual([REMOTE_URL]);
    });

    it('refuses registration by a non-owner (member) with 403', async () => {
      server = await startTestServer();
      const cookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
      const post = await fetch(`${server.baseUrl}/api/sideload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ url: REMOTE_URL, hash: PIN }),
      });
      expect(post.status).toBe(403);
      expect(server.sideload.size).toBe(0);
    });

    it('refuses an unauthenticated read with 401', async () => {
      server = await startTestServer();
      const res = await fetch(`${server.baseUrl}/api/sideload`);
      expect(res.status).toBe(401);
    });

    it('rejects inline/base64 code (URL-only) with 400', async () => {
      server = await startTestServer();
      const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      const post = await fetch(`${server.baseUrl}/api/sideload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ url: 'data:text/javascript;base64,ZXhwb3J0IHt9', hash: PIN }),
      });
      expect(post.status).toBe(400);
    });

    it('deregisters by url query param (owner)', async () => {
      server = await startTestServer();
      const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
      await fetch(`${server.baseUrl}/api/sideload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ url: REMOTE_URL, hash: PIN }),
      });
      const del = await fetch(`${server.baseUrl}/api/sideload?url=${encodeURIComponent(REMOTE_URL)}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(del.status).toBe(204);
      expect(server.sideload.size).toBe(0);
    });
  });
});
