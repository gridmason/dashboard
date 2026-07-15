import { describe, expect, it, vi } from 'vitest';
import type { LogPublicKey, MultihashString, verifyRelease } from '@gridmason/protocol/verify';
import type { SignatureBundle } from '@gridmason/protocol';
import type { AssembledModule } from './import-map-assembly';
import type { FederatedTrustConfig } from './federated-config';
import { verifyAssembledModules, verifyResolvedModule } from './release-verification';

const REGISTRY = 'registry.gridmason.dev';

/** A structurally-shaped bundle — the injected verify decides the verdict, not its contents. */
function bundle(tag: string): SignatureBundle {
  return {
    release: { formatVersion: '1.0', artifact: `${tag}@1.0.0`, files: {} },
    envelope: { format: 'gmb/1' },
    logEntry: { index: 1 },
  } as unknown as SignatureBundle;
}

function assembledModule(tag = 'acme-chart', url = `https://cdn.gridmason.dev/v1/artifacts/sha2-256:${tag}`): AssembledModule {
  return {
    source: REGISTRY,
    publisher: 'acme',
    tag,
    version: '1.0.0',
    specifier: `${REGISTRY}/${tag}`,
    url,
    bundle: bundle(tag),
  };
}

function trust(): FederatedTrustConfig {
  return {
    trustRoot: { version: 1 },
    pins: [],
    publisherCARoots: [new Uint8Array([1])],
    countersignRoots: [new Uint8Array([2])],
    logPublicKey: {} as LogPublicKey,
  };
}

function urlHashesFor(module: AssembledModule): Map<string, MultihashString> {
  return new Map<string, MultihashString>([[module.url, `sha2-256:${module.tag}` as MultihashString]]);
}

/** A verify that always refuses — used where the verdict is irrelevant to the assertion. */
const refuseAll = vi.fn(async () => ({
  ok: false as const,
  reason: 'content-hash-mismatch' as const,
})) as unknown as typeof verifyRelease;

describe('verifyResolvedModule (SPEC §2, §5; FR-10)', () => {
  it('hands verifyRelease the module bundle + trust material + clock, and returns the verified table', async () => {
    const module = assembledModule();
    const verify = vi.fn(async () => ({
      ok: true as const,
      urlHashes: urlHashesFor(module),
      issuer: 'https://issuer.example',
      subject: { artifact: 'acme-chart@1.0.0', releaseHash: 'sha2-256:x' },
    })) as unknown as typeof verifyRelease;

    const verdict = await verifyResolvedModule(module, trust(), { verify, now: () => 1234 });

    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.urlHashes).toEqual(urlHashesFor(module));

    const input = (verify as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(input.release).toBe(module.bundle.release);
    expect(input.envelope).toBe(module.bundle.envelope);
    expect(input.logEntry).toBe(module.bundle.logEntry);
    expect(input.trustRoot).toEqual({ version: 1 });
    expect(input.publisherCARoots).toEqual([new Uint8Array([1])]);
    expect(input.logPublicKey).toBeDefined();
    expect(input.now).toBe(1234);
  });

  it('returns a stable refusal reason when verifyRelease refuses (fail closed)', async () => {
    const verify = vi.fn(async () => ({
      ok: false as const,
      reason: 'publisher-untrusted' as const,
    })) as unknown as typeof verifyRelease;

    const verdict = await verifyResolvedModule(assembledModule(), trust(), { verify });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('publisher-untrusted');
  });
});

describe('verifyAssembledModules (SPEC §2, §5; FR-10)', () => {
  it('partitions a set into verified and refused', async () => {
    const a = assembledModule('acme-chart');
    const b = assembledModule('acme-map');
    const verify = vi.fn(async (input: Parameters<typeof verifyRelease>[0]) => {
      const artifact = (input.release as { artifact: string }).artifact;
      if (artifact === 'acme-chart@1.0.0') {
        return {
          ok: true as const,
          urlHashes: new Map<string, MultihashString>([[a.url, 'sha2-256:acme-chart' as MultihashString]]),
          issuer: 'https://issuer.example',
          subject: { artifact, releaseHash: 'sha2-256:x' },
        };
      }
      return { ok: false as const, reason: 'registry-countersignature-missing' as const };
    }) as unknown as typeof verifyRelease;

    const { verified, refused } = await verifyAssembledModules([a, b], trust(), { verify });

    expect(verified.map((v) => v.module.tag)).toEqual(['acme-chart']);
    expect(refused.map((r) => r.module.tag)).toEqual(['acme-map']);
    expect(refused[0]!.reason).toBe('registry-countersignature-missing');
    expect(verified[0]!.urlHashes.get(a.url)).toBe('sha2-256:acme-chart');
  });

  it('returns empty buckets for an empty module set', async () => {
    const { verified, refused } = await verifyAssembledModules([], trust(), { verify: refuseAll });
    expect(verified).toEqual([]);
    expect(refused).toEqual([]);
  });
});
