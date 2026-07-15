import { describe, expect, it } from 'vitest';
import type { GateSnapshot, ImportMapFragment, SignatureBundle } from '@gridmason/protocol';
import { ResolutionError, resolveGateSnapshot } from './resolution-client';

const ENDPOINT = 'https://registry.gridmason.dev/v1/resolve';
const REGISTRY = 'registry.gridmason.dev';

/** A structurally-complete-enough signature bundle — verification is out of scope (#16). */
function stubBundle(): SignatureBundle {
  return { release: {}, envelope: {}, logEntry: {} } as unknown as SignatureBundle;
}

function fragment(bundle: SignatureBundle = stubBundle()): ImportMapFragment {
  return {
    registry: REGISTRY,
    imports: { 'registry.gridmason.dev/acme-chart': '/v1/artifacts/sha2-256:abc' },
    scopes: {},
    modules: [
      {
        source: REGISTRY,
        publisher: 'acme',
        tag: 'acme-chart',
        version: '2.3.1',
        specifier: 'registry.gridmason.dev/acme-chart',
        url: '/v1/artifacts/sha2-256:abc',
        bundle,
      },
    ],
    excluded: [],
  };
}

const SNAPSHOT: GateSnapshot = {
  registry: REGISTRY,
  modules: [{ publisher: 'acme', tag: 'acme-chart', version: '2.3.1' }],
};

/** A `fetch` that records its call and returns a fixed response. */
function stubFetch(response: Response): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(response);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveGateSnapshot (SPEC §2, §8, FR-10)', () => {
  it('POSTs the snapshot anonymously and returns the fragment', async () => {
    const { fetch, calls } = stubFetch(jsonResponse(fragment()));
    const result = await resolveGateSnapshot(SNAPSHOT, { endpoint: ENDPOINT, fetchImpl: fetch });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ENDPOINT);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual(SNAPSHOT);
    // Anonymous: no authorization header rides the request.
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(result.registry).toBe(REGISTRY);
  });

  it('carries each signature bundle through untouched (by reference)', async () => {
    const bundle = stubBundle();
    const { fetch } = stubFetch(jsonResponse(fragment(bundle)));
    const result = await resolveGateSnapshot(SNAPSHOT, { endpoint: ENDPOINT, fetchImpl: fetch });
    // The exact bundle object is preserved — the client verifies nothing (#16).
    expect(result.modules[0]!.bundle).toEqual(bundle);
  });

  it('resolves an empty snapshot to an empty fragment', async () => {
    const empty: ImportMapFragment = { registry: REGISTRY, imports: {}, scopes: {}, modules: [], excluded: [] };
    const { fetch } = stubFetch(jsonResponse(empty));
    const result = await resolveGateSnapshot(
      { registry: REGISTRY, modules: [] },
      { endpoint: ENDPOINT, fetchImpl: fetch },
    );
    expect(result.modules).toEqual([]);
  });

  it('throws ResolutionError carrying the registry error envelope on a non-2xx', async () => {
    const { fetch } = stubFetch(
      jsonResponse({ error: { code: 'wrong_registry', message: 'registry mismatch' } }, 400),
    );
    await expect(
      resolveGateSnapshot(SNAPSHOT, { endpoint: ENDPOINT, fetchImpl: fetch }),
    ).rejects.toMatchObject({ name: 'ResolutionError', code: 'wrong_registry', status: 400 });
  });

  it('throws a generic ResolutionError on a non-2xx with no error envelope', async () => {
    const { fetch } = stubFetch(new Response('nope', { status: 503 }));
    await expect(
      resolveGateSnapshot(SNAPSHOT, { endpoint: ENDPOINT, fetchImpl: fetch }),
    ).rejects.toMatchObject({ code: 'resolve_failed', status: 503 });
  });

  it('throws ResolutionError on a transport failure', async () => {
    const fetchImpl: typeof fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    await expect(
      resolveGateSnapshot(SNAPSHOT, { endpoint: ENDPOINT, fetchImpl }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });

  it('throws ResolutionError on a body that is not a valid fragment', async () => {
    const { fetch } = stubFetch(jsonResponse({ registry: REGISTRY, imports: {} }));
    await expect(
      resolveGateSnapshot(SNAPSHOT, { endpoint: ENDPOINT, fetchImpl: fetch }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('exposes ResolutionError as an Error subclass with code/status', () => {
    const err = new ResolutionError('wrong_registry', 'mismatch', 400);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('wrong_registry');
    expect(err.status).toBe(400);
  });
});
