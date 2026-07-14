import { describe, expect, it } from 'vitest';
import {
  LOCAL_SOURCE,
  PLACEHOLDER_WIDGET_TAG,
  assembleImportMap,
  loadWidgetTag,
  toImportMapJson,
} from './import-map';
import { listPageTypes } from '../pages/page-types';

describe('local import map (SPEC §2, GW-D22)', () => {
  it('assembles the Phase-A placeholder as a local remote', () => {
    const map = assembleImportMap();
    const remote = map.get(PLACEHOLDER_WIDGET_TAG);
    expect(remote).toBeDefined();
    expect(remote!.source).toBe(LOCAL_SOURCE);
    expect(remote!.specifier).toContain(PLACEHOLDER_WIDGET_TAG);
    expect(typeof remote!.load).toBe('function');
  });

  it('projects a declarative `{ imports }` artifact for the Phase-B injection', () => {
    const map = assembleImportMap();
    const { imports } = toImportMapJson(map);
    const specifier = map.get(PLACEHOLDER_WIDGET_TAG)!.specifier;
    expect(imports[specifier]).toBe(specifier);
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
});
