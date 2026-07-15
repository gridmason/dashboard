/**
 * Tests for the dev-proxy SDK forward-leg endpoint (#34, cli FR-5): the host
 * receive endpoint the CLI's `gridmason dev --proxy` posts to, pinned in
 * `@gridmason/protocol` (`DEV_PROXY_SDK_PATH`, `DevProxySdkRequest/Response`). It
 * is **dev-mode only** and validates every request with the protocol guard.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_PROXY_SDK_PATH, isDevProxySdkResponse } from '@gridmason/protocol';
import { loginCookie, makeConfig, readJson, startTestServer, type TestServer } from './test-helpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** A test server whose deployment posture is `dev` (the dev-proxy endpoint is live). */
async function startDevServer(): Promise<TestServer> {
  return startTestServer({ ...makeConfig(), sideload: { mode: 'dev' } });
}

function post(baseUrl: string, body: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie !== undefined) headers.cookie = cookie;
  return fetch(`${baseUrl}${DEV_PROXY_SDK_PATH}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('dev-proxy endpoint gating', () => {
  it('does not exist outside dev mode (404)', async () => {
    server = await startTestServer(); // default posture = off
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const res = await post(server.baseUrl, { method: 'records.read', args: [{ recordType: 'customer', id: 'c1' }] }, cookie);
    expect(res.status).toBe(404);
  });

  it('requires a session in dev mode', async () => {
    server = await startDevServer();
    const res = await post(server.baseUrl, { method: 'records.read', args: [{ recordType: 'customer', id: 'c1' }] });
    expect(res.status).toBe(401);
  });
});

describe('dev-proxy SDK forward leg', () => {
  it('rejects a body that is not a DevProxySdkRequest', async () => {
    server = await startDevServer();
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const res = await post(server.baseUrl, { method: 42 }, cookie);
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(isDevProxySdkResponse(body)).toBe(true);
    expect(body.ok).toBe(false);
  });

  it('executes a records.read against the reference host', async () => {
    server = await startDevServer();
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const res = await post(
      server.baseUrl,
      { method: 'records.read', args: [{ recordType: 'customer', id: 'cust-9' }] },
      cookie,
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(isDevProxySdkResponse(body)).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.value.fields.name).toContain('cust-9');
  });

  it('enforces the user’s capabilities (defence in depth)', async () => {
    server = await startDevServer();
    const cookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
    // Bob's user caps grant only customer reads — an order read is refused host-side.
    const res = await post(server.baseUrl, { method: 'records.read', args: [{ recordType: 'order', id: 'o1' }] }, cookie);
    const body = await readJson(res);
    expect(isDevProxySdkResponse(body)).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('permission_denied');
  });

  it('answers an unsupported method with a typed failure', async () => {
    server = await startDevServer();
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const res = await post(server.baseUrl, { method: 'settings.update', args: [{}] }, cookie);
    const body = await readJson(res);
    expect(isDevProxySdkResponse(body)).toBe(true);
    expect(body.ok).toBe(false);
  });
});
