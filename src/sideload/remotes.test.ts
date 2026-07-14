import { describe, expect, it } from 'vitest';
import { sideloadRemote } from './remotes';
import type { DevSideloadRemote } from './allowlist-store';

const REMOTE: DevSideloadRemote = {
  origin: 'http://localhost:6070',
  entryUrl: 'http://localhost:6070/entry.js',
  tag: 'acme-dev-note',
  name: 'Field Notes',
  widgetID: { source: 'sideload:http://localhost:6070', tag: 'acme-dev-note' },
};

describe('sideloadRemote', () => {
  it('builds a LocalRemote carrying the sideload identity and a lazy loader', () => {
    const remote = sideloadRemote(REMOTE);
    expect(remote.tag).toBe('acme-dev-note');
    expect(remote.source).toBe('sideload:http://localhost:6070');
    expect(remote.name).toBe('Field Notes');
    expect(remote.specifier).toBe('sideload:http://localhost:6070/acme-dev-note');
    expect(typeof remote.load).toBe('function');
  });
});
