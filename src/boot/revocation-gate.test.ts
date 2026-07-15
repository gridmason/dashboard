import { describe, expect, it } from 'vitest';
import type {
  ImportMapFragment,
  ResolvedModule,
  SignatureBundle,
} from '@gridmason/protocol';
import type { ResolvedRegistry } from './import-map-assembly';
import { assembleFederatedImportMap } from './import-map-assembly';
import type { RegistryRevocationVerdict } from './revocation-feed';
import { applyRevocation, resolveKills, type MountedRemote } from './revocation-gate';

const REGISTRY = 'registry.gridmason.dev';
const OTHER = 'registry.other.dev';
const ORIGIN = 'https://cdn.gridmason.dev';

/** A structurally-present bundle — verification is out of scope here (#16). */
function stubBundle(): SignatureBundle {
  return { release: {}, envelope: {}, logEntry: {} } as unknown as SignatureBundle;
}

function module(
  registryId: string,
  tag: string,
  version: string,
): ResolvedModule {
  const specifier = `${registryId}/${tag}`;
  return {
    source: registryId,
    publisher: tag.split('-')[0],
    tag,
    version,
    specifier,
    url: `/v1/artifacts/sha2-256:${tag}-${version}`,
    bundle: stubBundle(),
  };
}

function resolvedRegistry(
  registryId: string,
  modules: readonly ResolvedModule[],
): ResolvedRegistry {
  const fragment: ImportMapFragment = {
    registry: registryId,
    imports: Object.fromEntries(modules.map((m) => [m.specifier, m.url])),
    scopes: Object.fromEntries(modules.map((m) => [m.url, { react: '/vendor/react@18.js' }])),
    modules,
    excluded: [],
  };
  return { fragment, servingOrigin: ORIGIN };
}

function fresh(
  registryId: string,
  blocked: RegistryRevocationVerdict['blocked'] = [],
): RegistryRevocationVerdict {
  return { registryId, status: 'fresh', failClosed: false, blocked };
}

function failed(registryId: string): RegistryRevocationVerdict {
  return { registryId, status: 'stale', failClosed: true, blocked: [] };
}

function verdicts(...vs: RegistryRevocationVerdict[]): Map<string, RegistryRevocationVerdict> {
  return new Map(vs.map((v) => [v.registryId, v]));
}

describe('applyRevocation (SPEC §2 kill switch, FR-12)', () => {
  it('keeps every remote of a fresh registry with no blocked entries', () => {
    const reg = resolvedRegistry(REGISTRY, [module(REGISTRY, 'acme-chart', '2.3.1')]);

    const { registries, refused } = applyRevocation([reg], verdicts(fresh(REGISTRY)));

    expect(refused).toEqual([]);
    expect(registries[0].fragment.modules).toHaveLength(1);
  });

  it('drops a killed remote from the fragment (imports, modules, scopes) — no redeploy', () => {
    const kept = module(REGISTRY, 'acme-chart', '2.3.1');
    const killed = module(REGISTRY, 'acme-clock', '1.2.0');
    const reg = resolvedRegistry(REGISTRY, [kept, killed]);

    const { registries, refused } = applyRevocation(
      [reg],
      verdicts(fresh(REGISTRY, [{ artifact: 'acme-clock@1.2.0', state: 'killed', severity: 'critical' }])),
    );

    const fragment = registries[0].fragment;
    expect(fragment.modules.map((m) => m.tag)).toEqual(['acme-chart']);
    expect(fragment.imports).toEqual({ [kept.specifier]: kept.url });
    expect(fragment.scopes).toEqual({ [kept.url]: { react: '/vendor/react@18.js' } });
    expect(refused).toEqual([
      { registryId: REGISTRY, publisher: 'acme', tag: 'acme-clock', version: '1.2.0', reason: 'killed' },
    ]);
  });

  it('a killed remote never appears in the assembled import map (end to end)', () => {
    const reg = resolvedRegistry(REGISTRY, [
      module(REGISTRY, 'acme-chart', '2.3.1'),
      module(REGISTRY, 'acme-clock', '1.2.0'),
    ]);

    // Toggle the feed: first nothing revoked, then acme-clock killed.
    const before = applyRevocation([reg], verdicts(fresh(REGISTRY)));
    const after = applyRevocation(
      [reg],
      verdicts(fresh(REGISTRY, [{ artifact: 'acme-clock@1.2.0', state: 'killed', severity: 'high' }])),
    );

    const mapBefore = assembleFederatedImportMap({ imports: {} }, before.registries);
    const mapAfter = assembleFederatedImportMap({ imports: {} }, after.registries);

    expect(Object.keys(mapBefore.imports)).toContain(`${REGISTRY}/acme-clock`);
    expect(Object.keys(mapAfter.imports)).not.toContain(`${REGISTRY}/acme-clock`);
    expect(mapAfter.modules.map((m) => m.tag)).toEqual(['acme-chart']);
  });

  it('blocks every version of a tag when the feed entry is unversioned', () => {
    const reg = resolvedRegistry(REGISTRY, [module(REGISTRY, 'acme-chart', '2.3.1')]);

    const { registries } = applyRevocation(
      [reg],
      verdicts(fresh(REGISTRY, [{ artifact: 'acme-chart', state: 'revoked', severity: 'low' }])),
    );

    expect(registries[0].fragment.modules).toHaveLength(0);
  });

  it('leaves a non-matching version untouched when the entry is version-qualified', () => {
    const reg = resolvedRegistry(REGISTRY, [module(REGISTRY, 'acme-chart', '2.3.1')]);

    const { registries, refused } = applyRevocation(
      [reg],
      verdicts(fresh(REGISTRY, [{ artifact: 'acme-chart@9.9.9', state: 'killed', severity: 'critical' }])),
    );

    expect(registries[0].fragment.modules).toHaveLength(1);
    expect(refused).toEqual([]);
  });

  it('fails a whole registry closed — scoped to its own remotes only', () => {
    const failing = resolvedRegistry(REGISTRY, [module(REGISTRY, 'acme-chart', '2.3.1')]);
    const healthy = resolvedRegistry(OTHER, [module(OTHER, 'beta-map', '1.0.0')]);

    const { registries, refused } = applyRevocation(
      [failing, healthy],
      verdicts(failed(REGISTRY), fresh(OTHER)),
    );

    // Only the healthy registry survives; the stale one's remote is refused.
    expect(registries.map((r) => r.fragment.registry)).toEqual([OTHER]);
    expect(refused).toEqual([
      { registryId: REGISTRY, publisher: 'acme', tag: 'acme-chart', version: '2.3.1', reason: 'registry-fail-closed' },
    ]);
  });

  it('fails a registry closed when it has no verdict (every gate must consume the feed)', () => {
    const reg = resolvedRegistry(REGISTRY, [module(REGISTRY, 'acme-chart', '2.3.1')]);

    const { registries, refused } = applyRevocation([reg], verdicts());

    expect(registries).toEqual([]);
    expect(refused[0]?.reason).toBe('registry-fail-closed');
  });

  it('does not mutate the input fragment', () => {
    const reg = resolvedRegistry(REGISTRY, [
      module(REGISTRY, 'acme-chart', '2.3.1'),
      module(REGISTRY, 'acme-clock', '1.2.0'),
    ]);
    const before = reg.fragment.modules.length;

    applyRevocation(
      [reg],
      verdicts(fresh(REGISTRY, [{ artifact: 'acme-clock@1.2.0', state: 'killed', severity: 'high' }])),
    );

    expect(reg.fragment.modules.length).toBe(before);
  });
});

describe('resolveKills — force-unmount decision (registry SPEC §6 revoked vs killed)', () => {
  const mounted: readonly MountedRemote[] = [
    { registryId: REGISTRY, tag: 'acme-chart', version: '2.3.1' },
    { registryId: REGISTRY, tag: 'acme-clock', version: '1.2.0' },
    { registryId: OTHER, tag: 'beta-map', version: '1.0.0' },
  ];

  it('unmounts a killed instance but leaves a revoked one running', () => {
    const kills = resolveKills(
      mounted,
      verdicts(
        fresh(REGISTRY, [
          { artifact: 'acme-chart@2.3.1', state: 'revoked', severity: 'low' },
          { artifact: 'acme-clock@1.2.0', state: 'killed', severity: 'critical' },
        ]),
        fresh(OTHER),
      ),
    );

    expect(kills).toEqual([{ registryId: REGISTRY, tag: 'acme-clock', version: '1.2.0' }]);
  });

  it('unmounts every mounted instance of a fail-closed registry, scoped to it', () => {
    const kills = resolveKills(mounted, verdicts(failed(REGISTRY), fresh(OTHER)));

    expect(kills).toEqual([
      { registryId: REGISTRY, tag: 'acme-chart', version: '2.3.1' },
      { registryId: REGISTRY, tag: 'acme-clock', version: '1.2.0' },
    ]);
  });

  it('unmounts a mounted instance whose registry has no verdict', () => {
    const kills = resolveKills(mounted, verdicts(fresh(OTHER)));

    expect(kills.map((k) => k.registryId)).toEqual([REGISTRY, REGISTRY]);
  });

  it('unmounts nothing when all registries are fresh and only revocations apply', () => {
    const kills = resolveKills(
      mounted,
      verdicts(fresh(REGISTRY, [{ artifact: 'acme-chart', state: 'revoked', severity: 'low' }]), fresh(OTHER)),
    );

    expect(kills).toEqual([]);
  });
});
