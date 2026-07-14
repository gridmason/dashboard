import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEV_SIDELOAD_ENV } from './dev-sideload-csp';
import { SIDELOAD_IMPORT_MAP, devSideloadImportScope } from './dev-sideload-import-scope';

/**
 * The dev-sideload import scope (issue #40) rides the same `GRIDMASON_DEV_SIDELOAD`
 * gate as the CSP relaxation: the `@gridmason/*` import map is injected **only** in
 * a dev server with the gate on, never otherwise. These pin that at the plugin
 * level (the whole-path proof is the `sideload-dev-import-scope` e2e).
 */

/** Invoke the plugin's `transformIndexHtml` hook, narrowing the function|object union. */
function injectTags() {
  const hook = devSideloadImportScope().transformIndexHtml;
  const fn = typeof hook === 'function' ? hook : hook?.handler;
  // The plugin ignores the html/ctx args; pass minimal stand-ins.
  return fn?.('<html></html>', {} as never);
}

describe('devSideloadImportScope', () => {
  const original = process.env[DEV_SIDELOAD_ENV];

  beforeEach(() => {
    delete process.env[DEV_SIDELOAD_ENV];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[DEV_SIDELOAD_ENV];
    else process.env[DEV_SIDELOAD_ENV] = original;
  });

  it('is serve-only (never runs during `vite build`)', () => {
    expect(devSideloadImportScope().apply).toBe('serve');
  });

  it('injects the @gridmason/* import map, up front, when the gate is on', () => {
    process.env[DEV_SIDELOAD_ENV] = '1';
    const tags = injectTags();
    expect(Array.isArray(tags)).toBe(true);
    const [tag] = tags as Array<Record<string, unknown>>;
    expect(tag.tag).toBe('script');
    expect(tag.attrs).toEqual({ type: 'importmap' });
    expect(tag.injectTo).toBe('head-prepend');
    expect(JSON.parse(tag.children as string)).toEqual({ imports: SIDELOAD_IMPORT_MAP });
  });

  it('injects nothing when the gate is off (dev experience untouched)', () => {
    expect(injectTags()).toBeUndefined();
  });

  it('maps only @gridmason/* specifiers — no framework specifiers', () => {
    for (const specifier of Object.keys(SIDELOAD_IMPORT_MAP)) {
      expect(specifier.startsWith('@gridmason/')).toBe(true);
    }
    expect(SIDELOAD_IMPORT_MAP).not.toHaveProperty('react');
    expect(SIDELOAD_IMPORT_MAP).not.toHaveProperty('vue');
    // The framework-agnostic surface a vanilla scaffold widget needs is present.
    expect(SIDELOAD_IMPORT_MAP['@gridmason/sdk']).toBeDefined();
    expect(SIDELOAD_IMPORT_MAP['@gridmason/protocol']).toBeDefined();
  });
});
