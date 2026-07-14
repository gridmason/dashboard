import { describe, expect, it } from 'vitest';
import { LOCAL_SOURCE } from '@gridmason/protocol';
import { isSideloadedId, SIDELOAD_BADGE_LABEL, sideloadSource } from './source';

describe('sideload source identity', () => {
  it('builds a sideload:<origin> source string', () => {
    expect(sideloadSource('http://localhost:6070')).toBe('sideload:http://localhost:6070');
  });

  it('recognizes a sideloaded identity', () => {
    expect(isSideloadedId({ source: sideloadSource('http://localhost:6070'), tag: 'acme-x' })).toBe(
      true,
    );
  });

  it('does not treat local or registry identities as sideloaded', () => {
    expect(isSideloadedId({ source: LOCAL_SOURCE, tag: 'gm-clock' })).toBe(false);
    expect(isSideloadedId({ source: 'registry.gridmason.dev', tag: 'acme-x' })).toBe(false);
  });

  it('is total — a malformed source is simply not sideloaded', () => {
    expect(isSideloadedId({ source: '', tag: 'x' })).toBe(false);
    expect(isSideloadedId({ source: 'sideload:', tag: 'x' })).toBe(false);
  });

  it('exposes the distinct badge label used on the card + picker', () => {
    expect(SIDELOAD_BADGE_LABEL).toBe('sideload');
  });
});
