import { describe, expect, it, vi } from 'vitest';
import type { ImportMapFragment, SignatureBundle } from '@gridmason/protocol';
import type { MultihashString, verifyRelease } from '@gridmason/protocol/verify';
import { bootFederated } from './federated-boot';
import { FederatedConfigError, type FederatedRegistryConfig, type FederatedTrustConfig } from './federated-config';

const REGISTRY = 'registry.gridmason.dev';
const ENDPOINT = 'https://registry.gridmason.dev/v1/resolve';
const SERVING = 'https://cdn.gridmason.dev';

/** The absolute entry URL the assembler composes from the serving origin + root-relative path. */
function absUrl(hash: string): string {
  return `${SERVING}/v1/artifacts/sha2-256:${hash}`;
}

function bundle(tag: string): SignatureBundle {
  return {
    release: { formatVersion: '1.0', artifact: `${tag}@1.0.0`, files: {} },
    envelope: { format: 'gmb/1' },
    logEntry: { index: 1 },
  } as unknown as SignatureBundle;
}

/** A resolved module in the fragment: root-relative URL, keyed under its bare specifier. */
function fragmentModule(tag: string, hash: string): ImportMapFragment['modules'][number] {
  return {
    source: REGISTRY,
    publisher: 'acme',
    tag,
    version: '1.0.0',
    specifier: `${REGISTRY}/${tag}`,
    url: `/v1/artifacts/sha2-256:${hash}`,
    bundle: bundle(tag),
  };
}

function trust(): FederatedTrustConfig {
  return {
    trustRoot: { version: 1 },
    pins: [],
    publisherCARoots: [new Uint8Array([1])],
    countersignRoots: [new Uint8Array([2])],
    logPublicKey: {} as never,
  };
}

function config(modules: FederatedRegistryConfig['gate']['modules']): FederatedRegistryConfig {
  return {
    gate: { registry: REGISTRY, modules },
    resolveEndpoint: ENDPOINT,
    servingOrigin: SERVING,
    trust: trust(),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(fragment: ImportMapFragment): { fetch: typeof globalThis.fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(jsonResponse(fragment));
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

/** A verify that succeeds for the named artifacts (returning their url→hash table) and refuses the rest. */
function makeVerify(pass: Record<string, Map<string, MultihashString>>): typeof verifyRelease {
  return vi.fn(async (input: Parameters<typeof verifyRelease>[0]) => {
    const artifact = (input.release as { artifact: string }).artifact;
    const table = pass[artifact];
    if (table !== undefined) {
      return { ok: true as const, urlHashes: table, issuer: 'https://issuer', subject: { artifact, releaseHash: 'sha2-256:x' } };
    }
    return { ok: false as const, reason: 'publisher-untrusted' as const };
  }) as unknown as typeof verifyRelease;
}

const GATE_MODULES = [{ publisher: 'acme', tag: 'acme-chart', version: '1.0.0' }];

describe('bootFederated (SPEC §2; FR-10)', () => {
  it('short-circuits with no network call when nothing is enabled', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const result = await bootFederated(config([]), { fetchImpl: fetch });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.remotes).toEqual([]);
    expect(result.imports).toEqual({});
    expect(result.urlHashes.size).toBe(0);
  });

  it('resolves, verifies, and produces a mountable verified remote', async () => {
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: { [`${REGISTRY}/acme-chart`]: '/v1/artifacts/sha2-256:aaa' },
      scopes: {},
      modules: [fragmentModule('acme-chart', 'aaa')],
      excluded: [],
    };
    const { fetch, calls } = stubFetch(fragment);
    const importModule = vi.fn(async () => ({}));
    const urlHashes = new Map<string, MultihashString>([[absUrl('aaa'), 'sha2-256:aaa' as MultihashString]]);
    const verify = makeVerify({ 'acme-chart@1.0.0': urlHashes });

    const result = await bootFederated(config(GATE_MODULES), { fetchImpl: fetch, verify, importModule });

    // Resolution hit the configured endpoint.
    expect(calls).toEqual([ENDPOINT]);
    // The verified module became a mountable remote with an absolute-URL loader.
    expect(result.remotes.map((r) => r.tag)).toEqual(['acme-chart']);
    expect(result.imports).toEqual({ [`${REGISTRY}/acme-chart`]: absUrl('aaa') });
    expect(result.refused).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.names.get('acme-chart')).toBe('acme-chart');
    // The enforcement table (keyed by exact URL) is plumbed for the D-E4 SW.
    expect(result.urlHashes.get(absUrl('aaa'))).toBe('sha2-256:aaa');

    await result.remotes[0]!.load();
    expect(importModule).toHaveBeenCalledWith(absUrl('aaa'));
  });

  it('fails closed: a module that does not verify is dropped from remotes, imports, and scopes', async () => {
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: {
        [`${REGISTRY}/acme-chart`]: '/v1/artifacts/sha2-256:aaa',
        [`${REGISTRY}/acme-evil`]: '/v1/artifacts/sha2-256:bbb',
      },
      // A scope keyed by the refused module's entry URL must be dropped with it.
      scopes: { '/v1/artifacts/sha2-256:bbb': { react: '/vendor/react-18.js' } },
      modules: [fragmentModule('acme-chart', 'aaa'), fragmentModule('acme-evil', 'bbb')],
      excluded: [],
    };
    const { fetch } = stubFetch(fragment);
    const verify = makeVerify({
      'acme-chart@1.0.0': new Map<string, MultihashString>([[absUrl('aaa'), 'sha2-256:aaa' as MultihashString]]),
    });

    const result = await bootFederated(config(GATE_MODULES), { fetchImpl: fetch, verify });

    expect(result.remotes.map((r) => r.tag)).toEqual(['acme-chart']);
    expect(result.imports).toEqual({ [`${REGISTRY}/acme-chart`]: absUrl('aaa') });
    // The refused module's URL never enters the injectable map or its scopes.
    expect(result.scopes).toEqual({});
    expect(Object.values(result.imports)).not.toContain(absUrl('bbb'));
    expect(result.urlHashes.has(absUrl('bbb'))).toBe(false);
    expect(result.refused.map((r) => ({ tag: r.module.tag, reason: r.reason }))).toEqual([
      { tag: 'acme-evil', reason: 'publisher-untrusted' },
    ]);
  });

  it('keeps a verified module\'s shared-dep scope, rekeyed to its absolute URL', async () => {
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: { [`${REGISTRY}/acme-chart`]: '/v1/artifacts/sha2-256:aaa' },
      scopes: { '/v1/artifacts/sha2-256:aaa': { react: '/vendor/react-18.js' } },
      modules: [fragmentModule('acme-chart', 'aaa')],
      excluded: [],
    };
    const { fetch } = stubFetch(fragment);
    const verify = makeVerify({
      'acme-chart@1.0.0': new Map<string, MultihashString>([[absUrl('aaa'), 'sha2-256:aaa' as MultihashString]]),
    });

    const result = await bootFederated(config(GATE_MODULES), { fetchImpl: fetch, verify });
    expect(result.scopes).toEqual({ [absUrl('aaa')]: { react: '/vendor/react-18.js' } });
  });

  it('carries excluded modules through for their fallback cards', async () => {
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: {},
      scopes: {},
      modules: [],
      excluded: [{ publisher: 'acme', tag: 'acme-gone', version: '9.9.9', reason: 'not_distributable' }],
    };
    const { fetch } = stubFetch(fragment);
    const result = await bootFederated(config(GATE_MODULES), { fetchImpl: fetch, verify: makeVerify({}) });

    expect(result.remotes).toEqual([]);
    expect(result.excluded).toEqual([
      { publisher: 'acme', tag: 'acme-gone', version: '9.9.9', reason: 'not_distributable' },
    ]);
  });

  it('rejects a structurally invalid config before any network call', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    await expect(
      bootFederated({ ...config(GATE_MODULES), resolveEndpoint: 'not-a-url' }, { fetchImpl: fetch }),
    ).rejects.toBeInstanceOf(FederatedConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
