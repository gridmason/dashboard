/**
 * End-to-end tests for the instance-token identity rail (SPEC §3, §6; FR-14) —
 * the reference enforcement code that makes the §3 token claims true over real
 * HTTP. Drives the demo API on an ephemeral port.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTANCE_TOKEN_HEADER } from '../sdk-identity/index';
import { loginCookie, readJson, startTestServer, type TestServer } from './test-helpers';

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(async () => {
  await server.close();
});

const WIDGET = { source: 'local', tag: 'gm-record-summary-widget' };

/** Register a minted instance token under `cookie`, declaring `capabilities`. Returns the token. */
async function registerInstance(
  cookie: string,
  capabilities: readonly string[],
  overrides: { instanceId?: string; token?: string } = {},
): Promise<string> {
  const token = overrides.token ?? `itk_${Math.random().toString(16).slice(2)}`;
  const res = await fetch(`${server.baseUrl}/api/sdk/instance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      token,
      instanceId: overrides.instanceId ?? `inst-${Math.random().toString(16).slice(2)}`,
      widgetId: WIDGET,
      capabilities,
    }),
  });
  expect(res.status).toBe(201);
  return token;
}

/** GET a record, optionally stamping the instance token header (omit to simulate an SDK bypass). */
function readRecord(cookie: string, path: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (token !== undefined) headers[INSTANCE_TOKEN_HEADER] = token;
  return fetch(`${server.baseUrl}/api/records/${path}`, { headers });
}

describe('instance-token registration', () => {
  it('registers a token under the caller session and requires auth', async () => {
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    await registerInstance(cookie, ['records.read:recordType:customer']);
    expect(server.identity.size).toBe(1);

    const unauth = await fetch(`${server.baseUrl}/api/sdk/instance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 't', instanceId: 'i', widgetId: WIDGET, capabilities: [] }),
    });
    expect(unauth.status).toBe(401);
  });

  it('revokes only the owning session’s token, then denies the stale token', async () => {
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const token = await registerInstance(cookie, ['records.read:recordType:customer']);
    // Bob cannot revoke Alice's token.
    const bobCookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
    const foreignRevoke = await fetch(`${server.baseUrl}/api/sdk/instance`, {
      method: 'DELETE',
      headers: { cookie: bobCookie, [INSTANCE_TOKEN_HEADER]: token },
    });
    expect(foreignRevoke.status).toBe(404);
    expect(server.identity.size).toBe(1);
    // The owner revokes; the token then no longer authorizes a call.
    const revoke = await fetch(`${server.baseUrl}/api/sdk/instance`, {
      method: 'DELETE',
      headers: { cookie, [INSTANCE_TOKEN_HEADER]: token },
    });
    expect(revoke.status).toBe(204);
    const after = await readRecord(cookie, 'customer/c1', token);
    expect(after.status).toBe(403);
    expect((await readJson(after)).error).toBe('instance_required');
  });
});

describe('a widget that bypasses the SDK is denied on every capability-gated route', () => {
  it('records read/query/write without an instance token get PermissionDenied (instance_required)', async () => {
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    // Session auth (cookie) present, but no instance token — an anonymous page script.
    const read = await readRecord(cookie, 'customer/c1');
    const query = await readRecord(cookie, 'customer');
    const write = await fetch(`${server.baseUrl}/api/records/customer/c1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'x' }),
    });
    for (const res of [read, query, write]) {
      expect(res.status).toBe(403);
      expect((await readJson(res)).error).toBe('instance_required');
    }
  });

  it('an unknown/forged token is refused (instance_required)', async () => {
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const res = await readRecord(cookie, 'customer/c1', 'itk_forged');
    expect(res.status).toBe(403);
    expect((await readJson(res)).error).toBe('instance_required');
  });

  it('a token registered under another session cannot be replayed (instance_foreign)', async () => {
    const aliceCookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const token = await registerInstance(aliceCookie, ['records.read:recordType:customer']);
    const bobCookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
    const res = await readRecord(bobCookie, 'customer/c1', token);
    expect(res.status).toBe(403);
    expect((await readJson(res)).error).toBe('instance_foreign');
  });
});

describe('the API enforces min(user, widget)', () => {
  it('allows a call both the user and the widget grant', async () => {
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const token = await registerInstance(cookie, ['records.read:recordType:customer']);
    const res = await readRecord(cookie, 'customer/cust-42', token);
    expect(res.status).toBe(200);
    const record = await readJson(res);
    expect(record.fields.name).toContain('cust-42');
  });

  it('denies when the call exceeds the widget’s declared capabilities', async () => {
    // Alice (broad user caps) mounts a widget that declared only customer reads.
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const token = await registerInstance(cookie, ['records.read:recordType:customer']);
    const res = await readRecord(cookie, 'order/o1', token);
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(body.error).toBe('permission_denied');
    expect(body.capability).toBe('records.read:recordType:order');
  });

  it('denies when the call exceeds the user’s permissions', async () => {
    // Bob's user caps grant only customer reads; the widget declared broad reads —
    // the intersection still excludes order, so the read is denied on the user side.
    const cookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
    const token = await registerInstance(cookie, ['records.read']);
    const allowed = await readRecord(cookie, 'customer/c1', token);
    expect(allowed.status).toBe(200);
    const denied = await readRecord(cookie, 'order/o1', token);
    expect(denied.status).toBe(403);
    expect((await readJson(denied)).error).toBe('permission_denied');
  });

  it('denies a write when the user lacks records.write (Bob)', async () => {
    const cookie = await loginCookie(server.baseUrl, 'bob', 'bob-dev-password');
    const token = await registerInstance(cookie, ['records.write:recordType:customer']);
    const res = await fetch(`${server.baseUrl}/api/records/customer/c1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie, [INSTANCE_TOKEN_HEADER]: token },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(403);
    expect((await readJson(res)).error).toBe('permission_denied');
  });

  it('allows a write both sides grant (Alice)', async () => {
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    const token = await registerInstance(cookie, ['records.write:recordType:customer']);
    const res = await fetch(`${server.baseUrl}/api/records/customer/c1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie, [INSTANCE_TOKEN_HEADER]: token },
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).fields.status).toBe('archived');
  });
});
