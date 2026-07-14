import { describe, expect, it, vi } from 'vitest';
import { sourceKind } from '@gridmason/protocol';
import { DevSideloadAllowlist } from './allowlist-store';

const REG = {
  origin: 'http://localhost:6070',
  entryUrl: 'http://localhost:6070/entry.js',
  tag: 'acme-dev-note',
  name: 'Field Notes',
};

describe('DevSideloadAllowlist', () => {
  it('derives a sideload:<origin> identity for an admitted remote', () => {
    const store = new DevSideloadAllowlist();
    const remote = store.register(REG);
    expect(remote.widgetID.source).toBe('sideload:http://localhost:6070');
    expect(remote.widgetID.tag).toBe('acme-dev-note');
    expect(sourceKind(remote.widgetID.source)).toBe('sideload');
  });

  it('is keyed by origin — re-registering a re-served remote replaces, not duplicates', () => {
    const store = new DevSideloadAllowlist();
    store.register(REG);
    store.register({ ...REG, name: 'Field Notes v2', entryUrl: 'http://localhost:6070/entry.js?v=2' });
    expect(store.snapshot()).toHaveLength(1);
    expect(store.get(REG.origin)?.name).toBe('Field Notes v2');
  });

  it('looks a remote up by its tag (the mount/badge path)', () => {
    const store = new DevSideloadAllowlist();
    store.register(REG);
    expect(store.byTag('acme-dev-note')?.origin).toBe(REG.origin);
    expect(store.byTag('nope')).toBeUndefined();
  });

  it('exposes admitted origins for the CSP layer', () => {
    const store = new DevSideloadAllowlist();
    store.register(REG);
    store.register({ ...REG, origin: 'http://localhost:6071', tag: 'acme-dev-chart' });
    expect(store.origins()).toEqual(['http://localhost:6070', 'http://localhost:6071']);
  });

  it('notifies subscribers on every mutation and publishes a fresh snapshot identity', () => {
    const store = new DevSideloadAllowlist();
    const listener = vi.fn();
    const before = store.snapshot();
    store.subscribe(listener);
    store.register(REG);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).not.toBe(before); // new array identity → useSyncExternalStore re-renders
    store.remove(REG.origin);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('clears every admitted remote (owner re-locks the gate)', () => {
    const store = new DevSideloadAllowlist();
    store.register(REG);
    store.clear();
    expect(store.snapshot()).toEqual([]);
  });

  it('unsubscribes cleanly', () => {
    const store = new DevSideloadAllowlist();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.register(REG);
    expect(listener).not.toHaveBeenCalled();
  });
});
