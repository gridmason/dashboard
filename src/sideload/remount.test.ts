import { describe, expect, it } from 'vitest';
import type { EffectiveLayout } from '@gridmason/core/engine';
import type { LayoutPage, LayoutWidget } from '@gridmason/protocol';
import type { GmPageCanvasElement } from '../canvas/gm-page-canvas';
import { instanceIdsForTag, layoutWithoutInstances, remountInstancesByTag } from './remount';

function widget(i: string, tag: string): LayoutWidget {
  return { widgetID: { source: 'local', tag }, i, x: 0, y: 0, w: 2, h: 2 };
}

function singleGrid(items: LayoutWidget[]): EffectiveLayout {
  const layout: LayoutPage = {
    schemaVersion: 1,
    page: 'demo',
    name: 'demo',
    default: true,
    grid: { items },
    hasTabs: false,
    tabs: [],
  };
  return { layout, lockedSlots: [] };
}

function tabbed(tabs: Array<{ name: string; items: LayoutWidget[] }>): EffectiveLayout {
  const layout: LayoutPage = {
    schemaVersion: 1,
    page: 'demo',
    name: 'demo',
    default: true,
    grid: { items: [] },
    hasTabs: true,
    tabs: tabs.map((t) => ({ name: t.name, grid: { items: t.items } })),
  };
  return { layout, lockedSlots: [] };
}

describe('instanceIdsForTag', () => {
  it('finds every placed instance of a tag across a single grid', () => {
    const { layout } = singleGrid([widget('a', 'acme-note'), widget('b', 'gm-clock'), widget('c', 'acme-note')]);
    expect(instanceIdsForTag(layout, 'acme-note')).toEqual(['a', 'c']);
  });

  it('scans every tab of a tabbed layout', () => {
    const { layout } = tabbed([
      { name: 'one', items: [widget('a', 'acme-note')] },
      { name: 'two', items: [widget('b', 'gm-clock'), widget('c', 'acme-note')] },
    ]);
    expect(instanceIdsForTag(layout, 'acme-note')).toEqual(['a', 'c']);
  });
});

describe('layoutWithoutInstances', () => {
  it('removes the given instances from a single grid without mutating the input', () => {
    const original = singleGrid([widget('a', 'acme-note'), widget('b', 'gm-clock')]);
    const next = layoutWithoutInstances(original, new Set(['a']));
    expect(next.layout.grid.items.map((it) => it.i)).toEqual(['b']);
    // Input untouched.
    expect(original.layout.grid.items.map((it) => it.i)).toEqual(['a', 'b']);
    expect(next.lockedSlots).toBe(original.lockedSlots);
  });

  it('removes instances from every tab of a tabbed layout', () => {
    const original = tabbed([
      { name: 'one', items: [widget('a', 'acme-note')] },
      { name: 'two', items: [widget('b', 'gm-clock'), widget('c', 'acme-note')] },
    ]);
    const next = layoutWithoutInstances(original, new Set(['a', 'c']));
    expect(next.layout.tabs[0]!.grid.items).toEqual([]);
    expect(next.layout.tabs[1]!.grid.items.map((it) => it.i)).toEqual(['b']);
  });
});

/** A fake canvas recording each `layout` assignment; reports a fixed mounted set. */
function fakeCanvas(layout: EffectiveLayout | undefined, mounted: string[]): {
  canvas: GmPageCanvasElement;
  assigns: Array<EffectiveLayout | undefined>;
} {
  const assigns: Array<EffectiveLayout | undefined> = [];
  let current = layout;
  const canvas = {
    get layout() {
      return current;
    },
    set layout(value: EffectiveLayout | undefined) {
      current = value;
      assigns.push(value);
    },
    mountedInstanceIds: mounted,
  } as unknown as GmPageCanvasElement;
  return { canvas, assigns };
}

describe('remountInstancesByTag', () => {
  it('unmounts then restores the tag’s mounted instances (a scoped remount)', () => {
    const original = singleGrid([widget('a', 'acme-note'), widget('b', 'gm-clock')]);
    const { canvas, assigns } = fakeCanvas(original, ['a', 'b']);

    remountInstancesByTag(canvas, 'acme-note');

    expect(assigns).toHaveLength(2);
    // First: the layout without instance `a` (it unmounts).
    expect(assigns[0]!.layout.grid.items.map((it) => it.i)).toEqual(['b']);
    // Then: the original restored (it mounts fresh).
    expect(assigns[1]).toBe(original);
  });

  it('is a no-op when no instance of the tag is currently mounted', () => {
    const original = singleGrid([widget('a', 'acme-note')]);
    // `a` is placed but not in the mounted set (e.g. offscreen / error state).
    const { canvas, assigns } = fakeCanvas(original, []);
    remountInstancesByTag(canvas, 'acme-note');
    expect(assigns).toHaveLength(0);
  });

  it('is a no-op when the tag is not placed at all', () => {
    const original = singleGrid([widget('a', 'gm-clock')]);
    const { canvas, assigns } = fakeCanvas(original, ['a']);
    remountInstancesByTag(canvas, 'acme-note');
    expect(assigns).toHaveLength(0);
  });

  it('is a no-op when the canvas has no layout yet', () => {
    const { canvas, assigns } = fakeCanvas(undefined, []);
    remountInstancesByTag(canvas, 'acme-note');
    expect(assigns).toHaveLength(0);
  });
});
