import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, loginCookie, type TestServer } from './test-helpers';
import { INSTANCE_TOKEN_HEADER, type UpstreamFetch } from '../scoped-fetch/index';
import { buildProductionCspDirectives } from '../../src/security/production-csp';

/**
 * The scoped-fetch proxy (SPEC §3, FR-13). These are the named acceptance tests:
 * a `net:<host>` widget works **only** through the proxy, the proxy re-checks the
 * declared host allowlist **server-side**, and a direct browser connection is
 * structurally impossible because the production `connect-src` never lists the
 * widget's host.
 */
describe('scoped-fetch proxy', () => {
  let server: TestServer | undefined;
  const upstreamCalls: { url: string; method: string; headers: Record<string, string> }[] = [];

  /** A stub upstream: records the outbound call and returns a fixed JSON response. */
  const upstream: UpstreamFetch = async (url, init) => {
    upstreamCalls.push({ url, method: init.method, headers: init.headers });
    return {
      status: 200,
      ok: true,
      headers: { forEach: (cb) => cb('application/json', 'content-type') },
      text: async () => '{"sales":[]}',
    };
  };

  afterEach(async () => {
    upstreamCalls.length = 0;
    await server?.close();
    server = undefined;
  });

  /** Boot a server with a seeded instance token → `net:<host>` grant, and sign in. */
  async function bootWithGrant(hosts: string[]): Promise<{ cookie: string; token: string }> {
    server = await startTestServer(undefined, { upstream });
    server.capabilities.set(
      'inst-token-1',
      hosts.map((host) => ({ api: 'net', scope: host })),
    );
    const cookie = await loginCookie(server.baseUrl, 'alice', 'alice-dev-password');
    return { cookie, token: 'inst-token-1' };
  }

  function post(
    baseUrl: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/scoped-fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('forwards an allowlisted host through the proxy and relays the scoped response', async () => {
    const { cookie, token } = await bootWithGrant(['api.acme.example']);
    const res = await post(
      server!.baseUrl,
      { cookie, [INSTANCE_TOKEN_HEADER]: token },
      { host: 'api.acme.example', path: '/v2/sales', method: 'GET' },
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { status: number; ok: boolean; body: string };
    expect(payload.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.body).toBe('{"sales":[]}');
    // The proxy — not the browser — made the outbound HTTPS call to the host.
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0]!.url).toBe('https://api.acme.example/v2/sales');
  });

  it('refuses a non-allowlisted host server-side, never reaching upstream', async () => {
    const { cookie, token } = await bootWithGrant(['api.acme.example']);
    const res = await post(
      server!.baseUrl,
      { cookie, [INSTANCE_TOKEN_HEADER]: token },
      { host: 'evil.example', path: '/steal' },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('net_host_not_allowed');
    expect(upstreamCalls).toHaveLength(0);
  });

  it('re-checks server-side: the allowlist comes from the instance token, not the request body', async () => {
    // The widget declares `api.acme.example`; asking for another host is denied even
    // though the body is fully attacker-controlled — the grant is server-resolved.
    const { cookie, token } = await bootWithGrant(['api.acme.example']);
    const res = await post(
      server!.baseUrl,
      { cookie, [INSTANCE_TOKEN_HEADER]: token },
      { host: 'internal.corp', path: '/admin' },
    );
    expect(res.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it('fails closed for a missing / unrecognized instance token (no capabilities)', async () => {
    const { cookie } = await bootWithGrant(['api.acme.example']);
    const noToken = await post(server!.baseUrl, { cookie }, { host: 'api.acme.example', path: '/v2/sales' });
    expect(noToken.status).toBe(403);
    expect(((await noToken.json()) as { error: string }).error).toBe('no_instance_capabilities');

    const badToken = await post(
      server!.baseUrl,
      { cookie, [INSTANCE_TOKEN_HEADER]: 'not-a-real-token' },
      { host: 'api.acme.example', path: '/v2/sales' },
    );
    expect(badToken.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it('requires a session — an unauthenticated caller is rejected before any check', async () => {
    await bootWithGrant(['api.acme.example']);
    const res = await post(
      server!.baseUrl,
      { [INSTANCE_TOKEN_HEADER]: 'inst-token-1' },
      { host: 'api.acme.example', path: '/v2/sales' },
    );
    expect(res.status).toBe(401);
  });

  it('rejects a "host" that smuggles a URL or credentials past the allowlist', async () => {
    const { cookie, token } = await bootWithGrant(['api.acme.example']);
    for (const host of ['http://internal/', 'api.acme.example@evil.example', 'api.acme.example/../x']) {
      const res = await post(
        server!.baseUrl,
        { cookie, [INSTANCE_TOKEN_HEADER]: token },
        { host, path: '/x' },
      );
      expect(res.status).toBe(400);
    }
    expect(upstreamCalls).toHaveLength(0);
  });

  it('does not forward the instance token or cookie to the upstream host', async () => {
    const { cookie, token } = await bootWithGrant(['api.acme.example']);
    await post(
      server!.baseUrl,
      { cookie, [INSTANCE_TOKEN_HEADER]: token },
      {
        host: 'api.acme.example',
        path: '/v2/sales',
        headers: { 'x-widget-header': 'kept', [INSTANCE_TOKEN_HEADER]: 'leaked', cookie: 'leaked' },
      },
    );
    const forwarded = upstreamCalls[0]!.headers;
    expect(forwarded['x-widget-header']).toBe('kept');
    expect(forwarded[INSTANCE_TOKEN_HEADER]).toBeUndefined();
    expect(forwarded['cookie']).toBeUndefined();
  });

  it('the production connect-src never lists the widget host — a direct browser connection is blocked', () => {
    // The other half of "works only via the proxy": even with the widget's host
    // declared, the enforced production CSP forbids the browser from opening a
    // connection to it. The builder has no net-host input, so it structurally can't.
    const directives = buildProductionCspDirectives({ registryOrigins: [], sideloadScriptSrc: [] });
    expect(directives['connect-src']).toEqual(["'self'"]);
    expect(directives['connect-src']).not.toContain('api.acme.example');
  });
});
