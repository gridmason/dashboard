import { describe, expect, it } from 'vitest';
import type { BlockedArtifact } from '@gridmason/protocol';
import type { RegistryRevocationVerdict } from './revocation-feed';
import { federatedKilledInstanceIds, type MountedFederatedInstance } from './federated-kills';

const REGISTRY = 'registry.gridmason.dev';

function fresh(blocked: readonly BlockedArtifact[]): RegistryRevocationVerdict {
  return { registryId: REGISTRY, status: 'fresh', failClosed: false, blocked };
}

function failClosed(): RegistryRevocationVerdict {
  return { registryId: REGISTRY, status: 'unverified', failClosed: true, blocked: [] };
}

function blocked(artifact: string, state: 'revoked' | 'killed'): BlockedArtifact {
  return { artifact, state, severity: 'high', reason: 'test' } as BlockedArtifact;
}

function verdicts(verdict: RegistryRevocationVerdict): ReadonlyMap<string, RegistryRevocationVerdict> {
  return new Map([[REGISTRY, verdict]]);
}

const MOUNTED: readonly MountedFederatedInstance[] = [
  { instanceId: 'i-chart', widgetID: { source: REGISTRY, tag: 'acme-chart' } },
];
const VERSIONS = new Map([['acme-chart', '1.0.0']]);

describe('federatedKilledInstanceIds (FR-12; #17 resolveKills adapter)', () => {
  it('unmounts every instance of a fail-closed registry', () => {
    expect(federatedKilledInstanceIds(MOUNTED, verdicts(failClosed()), VERSIONS)).toEqual(['i-chart']);
  });

  it('unmounts an instance whose tag a fresh feed marks killed', () => {
    const v = verdicts(fresh([blocked('acme-chart', 'killed')]));
    expect(federatedKilledInstanceIds(MOUNTED, v, VERSIONS)).toEqual(['i-chart']);
  });

  it('leaves a running instance whose tag is only revoked (revoke blocks new loads only)', () => {
    const v = verdicts(fresh([blocked('acme-chart', 'revoked')]));
    expect(federatedKilledInstanceIds(MOUNTED, v, VERSIONS)).toEqual([]);
  });

  it('matches an exact tag@version kill using the resolved version', () => {
    const v = verdicts(fresh([blocked('acme-chart@1.0.0', 'killed')]));
    expect(federatedKilledInstanceIds(MOUNTED, v, VERSIONS)).toEqual(['i-chart']);
    // Without the version, the exact tag@version entry cannot match (bare tag differs).
    expect(federatedKilledInstanceIds(MOUNTED, v, new Map())).toEqual([]);
  });

  it('never touches an instance from a non-governed source (local / other registry)', () => {
    const local: MountedFederatedInstance[] = [
      { instanceId: 'i-clock', widgetID: { source: 'local', tag: 'gm-clock-widget' } },
    ];
    expect(federatedKilledInstanceIds(local, verdicts(failClosed()), VERSIONS)).toEqual([]);
  });

  it('returns nothing when no instances are mounted', () => {
    expect(federatedKilledInstanceIds([], verdicts(failClosed()), VERSIONS)).toEqual([]);
  });
});
