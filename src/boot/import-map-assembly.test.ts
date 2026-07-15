import { describe, expect, it } from 'vitest';
import type { ImportMapFragment, ResolvedModule, SignatureBundle } from '@gridmason/protocol';
import type { ImportMapJson } from './import-map';
import {
  PrefixPinConflictError,
  assembleFederatedImportMap,
  type ResolvedRegistry,
} from './import-map-assembly';

const REGISTRY = 'registry.gridmason.dev';
const ORIGIN = 'https://cdn.gridmason.dev';

/** A stub bundle — the assembler carries it through untouched; verification is #16. */
function stubBundle(): SignatureBundle {
  return { release: {}, envelope: {}, logEntry: {} } as unknown as SignatureBundle;
}

function resolvedModule(tag: string, hash: string, bundle: SignatureBundle): ResolvedModule {
  return {
    source: REGISTRY,
    publisher: 'acme',
    tag,
    version: '2.3.1',
    specifier: `${REGISTRY}/${tag}`,
    url: `/v1/artifacts/sha2-256:${hash}`,
    bundle,
  };
}

const LOCAL: ImportMapJson = {
  imports: { 'local/gm-clock-widget': 'local/gm-clock-widget' },
};

function registry(fragment: ImportMapFragment, servingOrigin = ORIGIN): ResolvedRegistry {
  return { fragment, servingOrigin };
}

describe('assembleFederatedImportMap (SPEC §2, FR-10, GW-D22)', () => {
  it('returns the local map unchanged when no registry is enabled', () => {
    const assembled = assembleFederatedImportMap(LOCAL);
    expect(assembled.imports).toEqual(LOCAL.imports);
    expect(assembled.scopes).toEqual({});
    expect(assembled.modules).toEqual([]);
  });

  it('merges a registry fragment into the local map with absolute, rebased URLs', () => {
    const bundle = stubBundle();
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: { [`${REGISTRY}/acme-chart`]: '/v1/artifacts/sha2-256:chart' },
      scopes: {},
      modules: [resolvedModule('acme-chart', 'chart', bundle)],
      excluded: [],
    };
    const assembled = assembleFederatedImportMap(LOCAL, [registry(fragment)]);

    expect(assembled.imports).toEqual({
      'local/gm-clock-widget': 'local/gm-clock-widget',
      [`${REGISTRY}/acme-chart`]: `${ORIGIN}/v1/artifacts/sha2-256:chart`,
    });
    // The module's URL is rebased onto the serving origin too.
    expect(assembled.modules[0]!.url).toBe(`${ORIGIN}/v1/artifacts/sha2-256:chart`);
  });

  it('carries each signature bundle through untouched (by reference)', () => {
    const bundle = stubBundle();
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: { [`${REGISTRY}/acme-chart`]: '/v1/artifacts/sha2-256:chart' },
      scopes: {},
      modules: [resolvedModule('acme-chart', 'chart', bundle)],
      excluded: [],
    };
    const assembled = assembleFederatedImportMap(LOCAL, [registry(fragment)]);
    expect(assembled.modules[0]!.bundle).toBe(bundle);
  });

  it('scopes only the widget needing a non-default shared major — never a global override', () => {
    // The registry resolved two widgets against the shell's react offer (default
    // major 18): `acme-chart` takes the default (no scope), `acme-legacy` needs 17
    // (a scope keyed by its own entry URL). The assembler carries these through,
    // rekeyed to the absolute entry URLs.
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: {
        [`${REGISTRY}/acme-chart`]: '/v1/artifacts/sha2-256:chart',
        [`${REGISTRY}/acme-legacy`]: '/v1/artifacts/sha2-256:legacy',
      },
      scopes: {
        '/v1/artifacts/sha2-256:legacy': { react: '/vendor/react@17.js' },
      },
      modules: [
        resolvedModule('acme-chart', 'chart', stubBundle()),
        resolvedModule('acme-legacy', 'legacy', stubBundle()),
      ],
      excluded: [],
    };
    const assembled = assembleFederatedImportMap(LOCAL, [registry(fragment)]);

    // The non-default widget is scoped to react@17, keyed by its absolute entry URL.
    expect(assembled.scopes).toEqual({
      [`${ORIGIN}/v1/artifacts/sha2-256:legacy`]: { react: '/vendor/react@17.js' },
    });
    // The default widget produced no scope.
    expect(assembled.scopes[`${ORIGIN}/v1/artifacts/sha2-256:chart`]).toBeUndefined();
    // No global override: `react` is never a top-level import.
    expect(assembled.imports.react).toBeUndefined();
  });

  it('rejects a prefix-pin conflict as a config error', () => {
    // Two sources map the SAME specifier to different targets (a host misconfig that
    // pins one prefix to two registries) — refused, never silently resolved.
    const specifier = `${REGISTRY}/acme-chart`;
    const first: ImportMapFragment = {
      registry: REGISTRY,
      imports: { [specifier]: '/v1/artifacts/sha2-256:chart' },
      scopes: {},
      modules: [],
      excluded: [],
    };
    const second: ImportMapFragment = {
      registry: REGISTRY,
      imports: { [specifier]: '/v1/artifacts/sha2-256:chart' },
      scopes: {},
      modules: [],
      excluded: [],
    };
    expect(() =>
      assembleFederatedImportMap(LOCAL, [
        registry(first, 'https://cdn-a.gridmason.dev'),
        registry(second, 'https://cdn-b.gridmason.dev'),
      ]),
    ).toThrow(PrefixPinConflictError);
  });

  it('merges an identical repeat pin idempotently (no false conflict)', () => {
    const specifier = `${REGISTRY}/acme-chart`;
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: { [specifier]: '/v1/artifacts/sha2-256:chart' },
      scopes: {},
      modules: [],
      excluded: [],
    };
    const assembled = assembleFederatedImportMap(LOCAL, [
      registry(fragment),
      registry(fragment),
    ]);
    expect(assembled.imports[specifier]).toBe(`${ORIGIN}/v1/artifacts/sha2-256:chart`);
  });

  it('carries excluded modules through for the fallback cards', () => {
    const fragment: ImportMapFragment = {
      registry: REGISTRY,
      imports: {},
      scopes: {},
      modules: [],
      excluded: [{ publisher: 'acme', tag: 'acme-chart', version: '9.9.9', reason: 'unknown_module' }],
    };
    const assembled = assembleFederatedImportMap(LOCAL, [registry(fragment)]);
    expect(assembled.excluded).toEqual([
      { publisher: 'acme', tag: 'acme-chart', version: '9.9.9', reason: 'unknown_module' },
    ]);
  });
});
