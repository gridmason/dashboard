import { describe, expect, it } from 'vitest';
import {
  LOCAL_SOURCE,
  WIDGET_TAGS,
  assembleImportMap,
  describeWidget,
  loadWidgetTag,
  toImportMapJson,
} from './import-map';
import { listPageTypes } from '../pages/page-types';

describe('local import map (SPEC §2, GW-D22)', () => {
  it('assembles the five first-party demo widgets as local remotes', () => {
    const map = assembleImportMap();
    expect([...map.keys()].sort()).toEqual(Object.values(WIDGET_TAGS).sort());
    for (const tag of Object.values(WIDGET_TAGS)) {
      const remote = map.get(tag);
      expect(remote).toBeDefined();
      expect(remote!.source).toBe(LOCAL_SOURCE);
      expect(remote!.specifier).toContain(tag);
      expect(remote!.name.length).toBeGreaterThan(0);
      expect(typeof remote!.load).toBe('function');
    }
  });

  it('projects a declarative `{ imports }` artifact for the Phase-B injection', () => {
    const map = assembleImportMap();
    const { imports } = toImportMapJson(map);
    for (const remote of map.values()) {
      expect(imports[remote.specifier]).toBe(remote.specifier);
    }
  });

  it('carries every widget tag the four demo layouts reference (no dangling tags)', () => {
    const map = assembleImportMap();
    for (const { defaultLayout } of listPageTypes()) {
      const grids = defaultLayout.hasTabs
        ? defaultLayout.tabs.map((t) => t.grid)
        : [defaultLayout.grid];
      for (const grid of grids) {
        for (const item of grid.items) {
          expect(map.has(item.widgetID.tag)).toBe(true);
        }
      }
    }
  });

  it('resolves silently for a tag the map does not carry', async () => {
    await expect(loadWidgetTag(assembleImportMap(), 'gm-unmapped-widget')).resolves.toBeUndefined();
  });

  describe('describeWidget (fallback-card naming, SPEC §6/§8)', () => {
    it('names each first-party (local) widget for its fallback card', () => {
      for (const tag of Object.values(WIDGET_TAGS)) {
        expect(describeWidget({ widgetID: { source: LOCAL_SOURCE, tag } })).toBe(
          assembleImportMap().get(tag)!.name,
        );
      }
    });

    it('leaves an unknown tag or non-local source anonymous (no name echo)', () => {
      expect(describeWidget({ widgetID: { source: LOCAL_SOURCE, tag: 'gm-unknown' } })).toBeUndefined();
      expect(
        describeWidget({ widgetID: { source: 'registry:flagship', tag: WIDGET_TAGS.clock } }),
      ).toBeUndefined();
    });
  });
});
