import { describe, expect, it } from 'vitest';
import type { LogPublicKey } from '@gridmason/protocol/verify';
import {
  FederatedConfigError,
  validateFederatedRegistryConfig,
  type FederatedRegistryConfig,
  type FederatedTrustConfig,
} from './federated-config';

/** A well-shaped trust set — the verify lib re-checks the crypto, this validates structure only. */
function trust(overrides: Partial<FederatedTrustConfig> = {}): FederatedTrustConfig {
  return {
    trustRoot: { version: 1 },
    pins: [],
    publisherCARoots: [new Uint8Array([1, 2, 3])],
    countersignRoots: [new Uint8Array([4, 5, 6])],
    logPublicKey: {} as LogPublicKey,
    ...overrides,
  };
}

function config(overrides: Partial<FederatedRegistryConfig> = {}): FederatedRegistryConfig {
  return {
    gate: { registry: 'registry.gridmason.dev', modules: [] },
    resolveEndpoint: 'https://registry.gridmason.dev/v1/resolve',
    servingOrigin: 'https://cdn.gridmason.dev',
    feedUrl: 'https://registry.gridmason.dev/v1/revocation/feed',
    trust: trust(),
    ...overrides,
  };
}

describe('validateFederatedRegistryConfig (FR-10; GW-D21)', () => {
  it('accepts a well-formed single-registry federated config', () => {
    expect(() => validateFederatedRegistryConfig(config())).not.toThrow();
  });

  it('rejects a missing gate config', () => {
    expect(() => validateFederatedRegistryConfig(config({ gate: null as never }))).toThrow(
      FederatedConfigError,
    );
  });

  it('rejects an empty resolveEndpoint', () => {
    expect(() => validateFederatedRegistryConfig(config({ resolveEndpoint: '' }))).toThrow(
      /resolveEndpoint.*non-empty/,
    );
  });

  it('rejects a non-absolute resolveEndpoint', () => {
    expect(() => validateFederatedRegistryConfig(config({ resolveEndpoint: '/v1/resolve' }))).toThrow(
      /resolveEndpoint.*absolute URL/,
    );
  });

  it('rejects a non-http(s) serving origin', () => {
    expect(() =>
      validateFederatedRegistryConfig(config({ servingOrigin: 'ftp://cdn.example' })),
    ).toThrow(/servingOrigin.*http\(s\)/);
  });

  it('rejects a non-absolute revocation feed URL', () => {
    expect(() => validateFederatedRegistryConfig(config({ feedUrl: '/v1/revocation/feed' }))).toThrow(
      /feedUrl.*absolute URL/,
    );
  });

  it('rejects a missing trust object', () => {
    expect(() => validateFederatedRegistryConfig(config({ trust: null as never }))).toThrow(
      /`trust` must be a trust-config object/,
    );
  });

  it('rejects trust with no trustRoot field', () => {
    const bad = { pins: [], publisherCARoots: [], countersignRoots: [], logPublicKey: {} };
    expect(() =>
      validateFederatedRegistryConfig(config({ trust: bad as unknown as FederatedTrustConfig })),
    ).toThrow(/trust\.trustRoot.*required/);
  });

  it('rejects trust whose pins are not an array', () => {
    expect(() =>
      validateFederatedRegistryConfig(config({ trust: trust({ pins: {} as never }) })),
    ).toThrow(/trust\.pins.*array/);
  });

  it('rejects a pinned root that is not a Uint8Array', () => {
    expect(() =>
      validateFederatedRegistryConfig(
        config({ trust: trust({ publisherCARoots: ['not-a-key' as never] }) }),
      ),
    ).toThrow(/trust\.publisherCARoots\[0\].*Uint8Array/);
  });

  it('rejects a missing log public key', () => {
    expect(() =>
      validateFederatedRegistryConfig(config({ trust: trust({ logPublicKey: null as never }) })),
    ).toThrow(/trust\.logPublicKey/);
  });

  it('exposes FederatedConfigError as an Error subclass', () => {
    const err = new FederatedConfigError('detail');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FederatedConfigError');
    expect(err.message).toContain('detail');
  });
});
