import { describe, expect, it } from 'vitest';
import { buildProductionCspDirectives, buildProductionCspHeader } from './production-csp';

/**
 * The production CSP is the enforced deployment policy (SPEC §3 + §4, FR-13).
 * These tests pin the two load-bearing directives — a strict `script-src` and a
 * `connect-src` that no widget capability can widen — plus the per-mode sideload
 * handling and the locked-down remainder.
 */
describe('buildProductionCspDirectives', () => {
  const empty = { registryOrigins: [], sideloadScriptSrc: [] };

  it('locks script-src to the shell alone when no registry or sideload origin is configured', () => {
    const d = buildProductionCspDirectives(empty);
    expect(d['script-src']).toEqual(["'self'"]);
  });

  it('never grants script-src unsafe-inline or unsafe-eval (production ships neither)', () => {
    const d = buildProductionCspDirectives({
      registryOrigins: ['https://cdn.gridmason.dev'],
      sideloadScriptSrc: ['https://widgets.acme.example'],
    });
    expect(d['script-src']).not.toContain("'unsafe-inline'");
    expect(d['script-src']).not.toContain("'unsafe-eval'");
    expect(d['script-src']).not.toContain('*');
  });

  it('adds trusted registry-CDN origins to both script-src and connect-src (SPEC §3)', () => {
    const d = buildProductionCspDirectives({
      registryOrigins: ['https://cdn.gridmason.dev'],
      sideloadScriptSrc: [],
    });
    expect(d['script-src']).toContain('https://cdn.gridmason.dev');
    expect(d['connect-src']).toContain('https://cdn.gridmason.dev');
  });

  it('adds a connect-only registry origin (resolution/feed) to connect-src but not script-src', () => {
    const d = buildProductionCspDirectives({
      registryOrigins: ['https://cdn.gridmason.dev'],
      connectOrigins: ['https://registry.gridmason.dev'],
      sideloadScriptSrc: [],
    });
    expect(d['connect-src']).toContain('https://registry.gridmason.dev');
    expect(d['script-src']).not.toContain('https://registry.gridmason.dev');
  });

  it('connect-src carries only self + registry origins — never a third-party net host', () => {
    // The builder has no input for a net host, so a `net:<host>` widget's host can
    // never appear here: the browser must reach it through the scoped-fetch proxy.
    const d = buildProductionCspDirectives({
      registryOrigins: ['https://cdn.gridmason.dev'],
      connectOrigins: ['https://registry.gridmason.dev'],
      sideloadScriptSrc: ['https://widgets.acme.example'],
    });
    expect(d['connect-src']).toEqual([
      "'self'",
      'https://cdn.gridmason.dev',
      'https://registry.gridmason.dev',
    ]);
    // An acknowledged sideload origin widens script-src, never connect-src.
    expect(d['connect-src']).not.toContain('https://widgets.acme.example');
  });

  it('adds config-recorded acknowledged sideload origins to script-src only (SPEC §4)', () => {
    const d = buildProductionCspDirectives({
      registryOrigins: [],
      sideloadScriptSrc: ['https://widgets.acme.example'],
    });
    expect(d['script-src']).toContain('https://widgets.acme.example');
    expect(d['connect-src']).not.toContain('https://widgets.acme.example');
  });

  it('adds nothing when the sideload script-src list is empty (off / dev posture)', () => {
    // The caller passes `acknowledgedScriptSrc(mode, …)`, which is empty unless the
    // posture is `acknowledged`; an empty list must not relax the policy.
    const d = buildProductionCspDirectives(empty);
    expect(d['script-src']).toEqual(["'self'"]);
  });

  it('trims blanks and de-duplicates origins across the inputs', () => {
    const d = buildProductionCspDirectives({
      registryOrigins: ['https://cdn.gridmason.dev', ' https://cdn.gridmason.dev ', ''],
      sideloadScriptSrc: ['  ', 'https://widgets.acme.example'],
    });
    expect(d['script-src']).toEqual([
      "'self'",
      'https://cdn.gridmason.dev',
      'https://widgets.acme.example',
    ]);
  });

  it('locks the ambient directives down (no plugins, no framing, no base hijack)', () => {
    const d = buildProductionCspDirectives(empty);
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['frame-src']).toEqual(["'none'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['worker-src']).toEqual(["'self'"]);
  });
});

describe('buildProductionCspHeader', () => {
  it('serializes the default policy to a stable, self-only header string', () => {
    expect(buildProductionCspHeader({ registryOrigins: [], sideloadScriptSrc: [] })).toBe(
      "default-src 'self'; " +
        "script-src 'self'; " +
        "connect-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; " +
        "font-src 'self' data:; " +
        "worker-src 'self'; " +
        "manifest-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "frame-ancestors 'none'; " +
        "frame-src 'none'; " +
        "form-action 'self'",
    );
  });
});
