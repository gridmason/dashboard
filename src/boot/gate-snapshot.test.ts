import { describe, expect, it } from 'vitest';
import type { SharedOffer } from '@gridmason/protocol';
import {
  GateConfigError,
  buildGateSnapshot,
  type DeploymentGateConfig,
} from './gate-snapshot';

const REGISTRY = 'registry.gridmason.dev';

function config(overrides: Partial<DeploymentGateConfig> = {}): DeploymentGateConfig {
  return {
    registry: REGISTRY,
    modules: [{ publisher: 'acme', tag: 'acme-chart', version: '2.3.1' }],
    ...overrides,
  };
}

describe('buildGateSnapshot (SPEC §2, FR-10, GW-D21)', () => {
  it('projects the enabled modules into a protocol gate snapshot', () => {
    const snapshot = buildGateSnapshot(config());
    expect(snapshot).toEqual({
      registry: REGISTRY,
      modules: [{ publisher: 'acme', tag: 'acme-chart', version: '2.3.1' }],
    });
  });

  it('treats an omitted `enabled` flag as enabled', () => {
    const snapshot = buildGateSnapshot(
      config({ modules: [{ publisher: 'acme', tag: 'acme-chart', version: '1.0.0' }] }),
    );
    expect(snapshot.modules).toHaveLength(1);
  });

  it('drops a disabled module (gate = kill switch) so it never reaches the resolver', () => {
    const snapshot = buildGateSnapshot(
      config({
        modules: [
          { publisher: 'acme', tag: 'acme-chart', version: '2.3.1', enabled: true },
          { publisher: 'acme', tag: 'acme-map', version: '1.0.0', enabled: false },
        ],
      }),
    );
    expect(snapshot.modules.map((m) => m.tag)).toEqual(['acme-chart']);
  });

  it('accepts an empty enabled set and yields an empty snapshot', () => {
    const snapshot = buildGateSnapshot(config({ modules: [] }));
    expect(snapshot.modules).toEqual([]);
    expect(snapshot.registry).toBe(REGISTRY);
  });

  it('carries the shell shared offers through for resolve-time scoping', () => {
    const shared: Record<string, readonly SharedOffer[]> = {
      react: [
        { major: 18, url: '/vendor/react@18.js' },
        { major: 17, url: '/vendor/react@17.js' },
      ],
    };
    const snapshot = buildGateSnapshot(config({ shared }));
    expect(snapshot.shared).toEqual(shared);
  });

  it('omits `shared` entirely when the config declares none', () => {
    const snapshot = buildGateSnapshot(config());
    expect('shared' in snapshot).toBe(false);
  });

  describe('fails loud on a structurally invalid config (GateConfigError)', () => {
    it('rejects an empty registry id', () => {
      expect(() => buildGateSnapshot(config({ registry: '' }))).toThrow(GateConfigError);
    });

    it('rejects a non-array `modules`', () => {
      expect(() =>
        buildGateSnapshot(config({ modules: undefined as unknown as [] })),
      ).toThrow(GateConfigError);
    });

    it('rejects a module missing a non-empty version', () => {
      expect(() =>
        buildGateSnapshot(
          config({ modules: [{ publisher: 'acme', tag: 'acme-chart', version: '' }] }),
        ),
      ).toThrow(/version must be a non-empty string/);
    });

    it('rejects a non-boolean `enabled`', () => {
      expect(() =>
        buildGateSnapshot(
          config({
            modules: [
              {
                publisher: 'acme',
                tag: 'acme-chart',
                version: '1.0.0',
                enabled: 'yes' as unknown as boolean,
              },
            ],
          }),
        ),
      ).toThrow(/enabled must be a boolean/);
    });

    it('rejects a malformed shared offer', () => {
      expect(() =>
        buildGateSnapshot(
          config({
            shared: {
              react: [{ major: 18.5 as unknown as number, url: '/vendor/react.js' }],
            },
          }),
        ),
      ).toThrow(/major must be an integer/);
    });
  });
});
