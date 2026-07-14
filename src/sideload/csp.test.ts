import { describe, expect, it } from 'vitest';
import { buildDevCspHeader, sideloadScriptSrcAdditions } from './csp';

/**
 * The load-bearing invariant of dev sideload (SPEC §4): the localhost dev-server
 * origin is added to `script-src` **only** in a dev build with the gate on, and
 * the **production CSP is never relaxed**. These tests pin that at the policy
 * level, independent of how the header is delivered.
 */
describe('sideloadScriptSrcAdditions', () => {
  const origins = ['http://localhost:6070', 'http://127.0.0.1:6070'];

  it('adds the dev-server origins when dev build + gate on', () => {
    expect(sideloadScriptSrcAdditions({ dev: true, devSideloadEnabled: true, origins })).toEqual(
      origins,
    );
  });

  it('adds nothing in a production build — even with the gate on and origins present', () => {
    expect(
      sideloadScriptSrcAdditions({ dev: false, devSideloadEnabled: true, origins }),
    ).toEqual([]);
  });

  it('adds nothing when the dev gate is off', () => {
    expect(
      sideloadScriptSrcAdditions({ dev: true, devSideloadEnabled: false, origins }),
    ).toEqual([]);
  });

  it('trims blanks and de-duplicates origins', () => {
    expect(
      sideloadScriptSrcAdditions({
        dev: true,
        devSideloadEnabled: true,
        origins: ['http://localhost:6070', ' http://localhost:6070 ', '', '   '],
      }),
    ).toEqual(['http://localhost:6070']);
  });
});

describe('buildDevCspHeader', () => {
  it('lists the dev-server origins in both script-src and connect-src when the gate is on', () => {
    const header = buildDevCspHeader({
      dev: true,
      devSideloadEnabled: true,
      origins: ['http://localhost:6070'],
    });
    const scriptSrc = header.split('; ').find((d) => d.startsWith('script-src '));
    const connectSrc = header.split('; ').find((d) => d.startsWith('connect-src '));
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain('http://localhost:6070');
    expect(connectSrc).toContain('http://localhost:6070');
  });

  it('never lists a dev-server origin in a production build', () => {
    const header = buildDevCspHeader({
      dev: false,
      devSideloadEnabled: true,
      origins: ['http://localhost:6070'],
    });
    expect(header).not.toContain('localhost');
    expect(header).toContain("script-src 'self'");
  });

  it('omits the origin when the gate is off but keeps the dev baseline usable', () => {
    const header = buildDevCspHeader({
      dev: true,
      devSideloadEnabled: false,
      origins: ['http://localhost:6070'],
    });
    expect(header).not.toContain('localhost');
    // The baseline still grants what the Vite dev server needs.
    expect(header).toContain("'unsafe-inline'");
  });
});
