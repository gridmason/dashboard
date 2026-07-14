/**
 * api/auth-stub — the stub login gates routes (FR-6 acceptance, GW-D21): an
 * unauthenticated request to a protected route is rejected, and a config-file
 * user can log in and reach it. Also covers the public liveness probe that
 * proves the service booted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loginCookie, makeLayoutDoc, startTestServer, type TestServer } from './test-helpers';

describe('api/auth-stub', () => {
  let server: TestServer;
  afterEach(async () => {
    await server?.close();
  });

  it('serves the public health probe (service is up)', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    server = await startTestServer();
    const layouts = await fetch(`${server.baseUrl}/api/layouts/user:alice/dashboards.home`);
    expect(layouts.status).toBe(401);
    const me = await fetch(`${server.baseUrl}/api/auth/me`);
    expect(me.status).toBe(401);
  });

  it('rejects a bad password without a session cookie', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it('lets a config-file user log in and reach protected routes', async () => {
    server = await startTestServer();
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');

    const me = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { username: string; password?: string } };
    expect(body.user.username).toBe('alice');
    // The public user view never leaks the password.
    expect(body.user.password).toBeUndefined();

    // A write to a protected layout route now succeeds.
    const put = await fetch(`${server.baseUrl}/api/layouts/user:alice/dashboards.home`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(makeLayoutDoc()),
    });
    expect(put.status).toBe(200);
  });

  it('drops the session on logout', async () => {
    server = await startTestServer();
    const cookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');

    const out = await fetch(`${server.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(out.status).toBe(204);

    const after = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { cookie } });
    expect(after.status).toBe(401);
  });
});
