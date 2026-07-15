import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildProductionCspHeader } from './production-csp';

/**
 * The production image (`docker/nginx.conf`) hard-codes the enforced CSP string
 * because nginx cannot call the builder. This test is the drift guard: the checked
 * -in header must equal the single source of truth's default output, so a change to
 * the policy that forgets to update nginx.conf fails here instead of shipping a
 * stale header (FR-13).
 */
describe('docker/nginx.conf CSP', () => {
  it('matches buildProductionCspHeader for the default (self-only) posture', () => {
    const nginxConf = readFileSync(
      fileURLToPath(new URL('../../docker/nginx.conf', import.meta.url)),
      'utf8',
    );
    const match = nginxConf.match(/add_header Content-Security-Policy "([^"]+)"/);
    expect(match, 'nginx.conf must declare a Content-Security-Policy add_header').not.toBeNull();
    expect(match![1]).toBe(buildProductionCspHeader({ registryOrigins: [], sideloadScriptSrc: [] }));
  });
});
