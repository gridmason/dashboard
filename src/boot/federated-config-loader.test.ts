/**
 * The federated-config loader (FR-10; SPEC §2, §4.4). It fetches the deployment's
 * `federated.json` from the app's own origin (the SPEC §4.4 deploy-time trust
 * channel), decodes the base64 binary trust fields, and validates the envelope:
 *
 * - **absent / unreachable** → `null` (federation stays inert — today's behavior);
 * - **served but malformed** → `FederatedConfigError` (fail loud, never silent-inert).
 */
import { describe, expect, it, vi } from 'vitest';
import { FederatedConfigError } from './federated-config';
import {
  decodeFederatedConfig,
  loadFederatedConfig,
  type FederatedRegistryConfigWire,
} from './federated-config-loader';

/** base64 of a byte array (browser `btoa`, available under jsdom). */
function b64(bytes: readonly number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

/** A well-formed wire config (base64 binary fields), matching the local-dev example. */
function wire(overrides: Partial<FederatedRegistryConfigWire> = {}): FederatedRegistryConfigWire {
  return {
    gate: {
      registry: 'localhost-registry',
      modules: [{ publisher: 'demo', tag: 'demo-hello', version: '0.1.0' }],
    },
    resolveEndpoint: 'http://localhost:8080/v1/resolve',
    feedUrl: 'http://localhost:8080/v1/revocation/feed',
    servingOrigin: 'http://localhost:8080',
    trust: {
      trustRoot: { formatVersion: '1.0', registryId: 'localhost-registry' },
      pins: [{ registryId: 'localhost-registry', root: 'root-1', channel: 'deploy-time' }],
      publisherCARoots: [],
      countersignRoots: [b64([4, 5, 6])],
      logPublicKey: { name: 'localhost-registry', key: b64(new Array(32).fill(7)) },
    },
    ...overrides,
  };
}

/** A `fetch` that resolves to `response` and records the URL it was called with. */
function fetchReturning(response: Response): { fetch: typeof globalThis.fetch; urls: string[] } {
  const urls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL) => {
    urls.push(String(input));
    return Promise.resolve(response);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('decodeFederatedConfig', () => {
  it('decodes the base64 binary trust fields to bytes and passes the rest through', () => {
    const config = decodeFederatedConfig(wire());
    expect(config.trust.countersignRoots[0]).toBeInstanceOf(Uint8Array);
    expect([...config.trust.countersignRoots[0]]).toEqual([4, 5, 6]);
    expect(config.trust.logPublicKey.key).toBeInstanceOf(Uint8Array);
    expect(config.trust.logPublicKey.key).toHaveLength(32);
    expect(config.resolveEndpoint).toBe('http://localhost:8080/v1/resolve');
    // trustRoot is opaque, carried through untouched.
    expect(config.trust.trustRoot).toEqual({ formatVersion: '1.0', registryId: 'localhost-registry' });
  });

  it('rejects a non-object config', () => {
    expect(() => decodeFederatedConfig('nope')).toThrow(FederatedConfigError);
  });

  it('rejects invalid base64 in a pinned root', () => {
    const w = wire();
    const bad: unknown = { ...w, trust: { ...w.trust, countersignRoots: ['not valid base64 !!!'] } };
    expect(() => decodeFederatedConfig(bad)).toThrow(/countersignRoots\[0\].*base64/);
  });

  it('rejects a missing trustRoot field', () => {
    const w = wire();
    const bad: unknown = {
      ...w,
      trust: {
        pins: w.trust.pins,
        publisherCARoots: w.trust.publisherCARoots,
        countersignRoots: w.trust.countersignRoots,
        logPublicKey: w.trust.logPublicKey,
      },
    };
    expect(() => decodeFederatedConfig(bad)).toThrow(/trust\.trustRoot.*required/);
  });

  it('rejects a non-string log key name', () => {
    const w = wire();
    const bad: unknown = {
      ...w,
      trust: { ...w.trust, logPublicKey: { name: 42, key: w.trust.logPublicKey.key } },
    };
    expect(() => decodeFederatedConfig(bad)).toThrow(/logPublicKey\.name/);
  });
});

describe('loadFederatedConfig', () => {
  it('returns null when no config is served (404) — federation stays inert', async () => {
    const { fetch } = fetchReturning(new Response(null, { status: 404 }));
    expect(await loadFederatedConfig({ fetch, base: '/' })).toBeNull();
  });

  it('returns null when the config is unreachable (fetch rejects)', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('network'))) as unknown as typeof globalThis.fetch;
    expect(await loadFederatedConfig({ fetch, base: '/' })).toBeNull();
  });

  it('returns null on a non-2xx transport error (5xx)', async () => {
    const { fetch } = fetchReturning(new Response('oops', { status: 500 }));
    expect(await loadFederatedConfig({ fetch, base: '/' })).toBeNull();
  });

  it('throws when a config IS served but is not valid JSON (fail loud)', async () => {
    const { fetch } = fetchReturning(new Response('{ not json', { status: 200 }));
    await expect(loadFederatedConfig({ fetch, base: '/' })).rejects.toThrow(FederatedConfigError);
  });

  it('loads, decodes, and validates a well-formed config', async () => {
    const { fetch } = fetchReturning(jsonResponse(wire()));
    const config = await loadFederatedConfig({ fetch, base: '/' });
    expect(config).not.toBeNull();
    expect(config!.gate.registry).toBe('localhost-registry');
    expect(config!.trust.logPublicKey.key).toBeInstanceOf(Uint8Array);
  });

  it('fails loud when a served config is structurally invalid (non-absolute endpoint)', async () => {
    const { fetch } = fetchReturning(jsonResponse(wire({ resolveEndpoint: '/v1/resolve' })));
    await expect(loadFederatedConfig({ fetch, base: '/' })).rejects.toThrow(/resolveEndpoint.*absolute/);
  });

  it('resolves the config under the app base path (subpath hosting)', async () => {
    const { fetch, urls } = fetchReturning(new Response(null, { status: 404 }));
    await loadFederatedConfig({ fetch, base: '/demo/' });
    expect(urls).toEqual(['/demo/federated.json']);
  });
});
