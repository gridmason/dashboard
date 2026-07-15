import { afterEach, describe, expect, it } from 'vitest';
import { buildProductionCspHeader } from '../src/security/production-csp';
import { previewCspHeader, REGISTRY_ORIGINS_ENV } from './production-csp';

/**
 * The preview server reports the production policy from the single source of truth
 * (SPEC §3, FR-13). These tests pin that it defaults to the strict self-only base
 * and that a federated deployment's registry origins flow through from the env.
 */
describe('previewCspHeader', () => {
  const original = process.env[REGISTRY_ORIGINS_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[REGISTRY_ORIGINS_ENV];
    else process.env[REGISTRY_ORIGINS_ENV] = original;
  });

  it('reports the strict self-only base policy with no registry origins configured', () => {
    delete process.env[REGISTRY_ORIGINS_ENV];
    expect(previewCspHeader()).toBe(
      buildProductionCspHeader({ registryOrigins: [], sideloadScriptSrc: [] }),
    );
    expect(previewCspHeader()).toContain("script-src 'self';");
  });

  it('adds registry-CDN origins from the env to script-src and connect-src', () => {
    process.env[REGISTRY_ORIGINS_ENV] = 'https://cdn.gridmason.dev, https://cdn2.gridmason.dev';
    const header = previewCspHeader();
    expect(header).toContain('https://cdn.gridmason.dev');
    expect(header).toContain('https://cdn2.gridmason.dev');
    expect(header).toBe(
      buildProductionCspHeader({
        registryOrigins: ['https://cdn.gridmason.dev', 'https://cdn2.gridmason.dev'],
        sideloadScriptSrc: [],
      }),
    );
  });
});
