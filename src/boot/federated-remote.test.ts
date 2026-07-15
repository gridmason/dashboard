import { describe, expect, it, vi } from 'vitest';
import type { MultihashString } from '@gridmason/protocol/verify';
import type { SignatureBundle } from '@gridmason/protocol';
import type { AssembledModule } from './import-map-assembly';
import type { VerifiedModule } from './release-verification';
import { federatedRemote } from './federated-remote';

const REGISTRY = 'registry.gridmason.dev';
const ENTRY_URL = 'https://cdn.gridmason.dev/v1/artifacts/sha2-256:abc';

function verifiedModule(): VerifiedModule {
  const module: AssembledModule = {
    source: REGISTRY,
    publisher: 'acme',
    tag: 'acme-chart',
    version: '2.3.1',
    specifier: `${REGISTRY}/acme-chart`,
    url: ENTRY_URL,
    bundle: { release: {}, envelope: {}, logEntry: {} } as unknown as SignatureBundle,
  };
  return {
    module,
    urlHashes: new Map<string, MultihashString>([[ENTRY_URL, 'sha2-256:abc' as MultihashString]]),
  };
}

describe('federatedRemote (SPEC §2; FR-10)', () => {
  it('carries the module identity into a LocalRemote', () => {
    const remote = federatedRemote(verifiedModule());
    expect(remote.tag).toBe('acme-chart');
    expect(remote.source).toBe(REGISTRY);
    expect(remote.specifier).toBe(`${REGISTRY}/acme-chart`);
    expect(remote.name).toBe('acme-chart');
  });

  it('imports the verified absolute entry URL on activation (not at build)', async () => {
    const importModule = vi.fn(async () => ({ default: 'module' }));
    const remote = federatedRemote(verifiedModule(), { importModule });

    // Building the remote must not import anything — lazy activation only (SPEC §2).
    expect(importModule).not.toHaveBeenCalled();

    await remote.load();
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(importModule).toHaveBeenCalledWith(ENTRY_URL);
  });
});
