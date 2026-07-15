import { describe, expect, it } from 'vitest';
import { resolveLayout } from '@gridmason/core/engine';
import { CURRENT_LAYOUT_SCHEMA_VERSION } from '@gridmason/protocol';
import { LOCAL_SOURCE, WIDGET_TAGS } from '../boot/import-map';
import { getPageType, listPageTypes, resolvePageType } from './page-types';

/** The set of first-party demo widget tags every placement must reference. */
const KNOWN_TAGS = new Set<string>(Object.values(WIDGET_TAGS));

/** Every item across a page type's default single-grid layout. */
function items(id: string) {
  return getPageType(id)!.defaultLayout.grid.items;
}

describe('demo page types (FR-2, SPEC §5)', () => {
  it('registers exactly the five demo page types', () => {
    expect(listPageTypes().map((p) => p.descriptor.id)).toEqual([
      'dashboards.home',
      'demo.record-detail',
      'demo.locked',
      'demo.telemetry',
      'demo.full-canvas',
    ]);
  });

  it('every default layout is a current-version single-grid doc targeting its own id', () => {
    for (const { descriptor, defaultLayout } of listPageTypes()) {
      expect(defaultLayout.page).toBe(descriptor.id);
      expect(defaultLayout.schemaVersion).toBe(CURRENT_LAYOUT_SCHEMA_VERSION);
      expect(defaultLayout.default).toBe(true);
      expect(defaultLayout.hasTabs).toBe(false);
      expect(defaultLayout.grid.items.length).toBeGreaterThan(0);
      for (const item of defaultLayout.grid.items) {
        expect(item.widgetID.source).toBe(LOCAL_SOURCE);
        expect(KNOWN_TAGS.has(item.widgetID.tag)).toBe(true);
      }
    }
  });

  it('resolved locked slots match each descriptor exactly', () => {
    for (const { descriptor, defaultLayout } of listPageTypes()) {
      const effective = resolveLayout({
        default: { layout: defaultLayout, locks: descriptor.locks },
      });
      expect(effective.lockedSlots).toEqual(descriptor.locks);
    }
  });

  it('dashboards.home is a free canvas: no context, no locks, user-customizable', () => {
    const home = getPageType('dashboards.home')!.descriptor;
    expect(home.context).toEqual({});
    expect(home.locks).toEqual([]);
    expect(home.allow_user_customization).toBe(true);
  });

  it('dashboards.home places the crasher so its default view exercises the error boundary', () => {
    const tags = items('dashboards.home').map((i) => i.widgetID.tag);
    expect(tags).toContain(WIDGET_TAGS.crasher);
    expect(tags).toContain(WIDGET_TAGS.chart);
  });

  it('demo.record-detail carries a typed record-ref context and a locked header slot', () => {
    const rd = getPageType('demo.record-detail')!.descriptor;
    expect(rd.context).toEqual({ record: { type: 'record-ref', recordType: 'customer' } });
    expect(rd.locks).toContain('header');
    expect(rd.allow_user_customization).toBe(true);
    const header = items('demo.record-detail').find((i) => i.slot === 'header');
    expect(header).toBeDefined();
    // The record-summary (context consumer) fills the locked header slot.
    expect(header!.widgetID.tag).toBe(WIDGET_TAGS.recordSummary);
  });

  it('demo.locked is fully locked: customization off and every slot locked', () => {
    const locked = getPageType('demo.locked')!.descriptor;
    expect(locked.allow_user_customization).toBe(false);
    const slots = items('demo.locked').map((i) => i.slot);
    expect(slots.every((s) => s !== undefined)).toBe(true);
    for (const slot of slots) expect(locked.locks).toContain(slot);
  });

  it('demo.full-canvas is one maximized locked widget spanning the grid', () => {
    const fc = getPageType('demo.full-canvas')!;
    expect(fc.descriptor.allow_user_customization).toBe(false);
    const only = fc.defaultLayout.grid.items;
    expect(only).toHaveLength(1);
    expect(only[0]!.slot).toBe('main');
    expect(fc.descriptor.locks).toEqual(['main']);
    expect(only[0]).toMatchObject({ x: 0, y: 0, w: 12 });
  });

  it('resolves an unknown page type to the default page type', () => {
    expect(resolvePageType('nope.nope').descriptor.id).toBe('dashboards.home');
  });
});
