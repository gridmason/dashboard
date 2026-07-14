/**
 * The governance demo's 3-level resolution, proven purely (FR-4, SPEC §5) — the
 * headless half of what the `/governance` view makes visible and the Playwright
 * flow drives through the DOM. Composes the real `demo.record-detail` default,
 * the demo {@link ORG_PUBLICATION}, and a user override through `resolveLayout`
 * and asserts the two governance rules: the org's added `metrics` lock is
 * authoritative over the user, while the free `notes` slot is the user's to move.
 */
import { describe, expect, it } from 'vitest';
import { resolveLayout } from '@gridmason/core/engine';
import type { LayoutPage, LayoutWidget } from '@gridmason/protocol';
import { getPageType } from '../pages/page-types';
import { GOVERNED_PAGE, ORG_PUBLICATION, ORG_LOCKED_SLOT } from './org-publication';

const pageType = getPageType(GOVERNED_PAGE.pageType)!;
const defaultLevel = { layout: pageType.defaultLayout, locks: pageType.descriptor.locks };
const orgLevel = { layout: ORG_PUBLICATION.layout, locks: ORG_PUBLICATION.locks };

/** The placed item filling `slot` in a resolved single-grid layout. */
function bySlot(layout: LayoutPage, slot: string): LayoutWidget | undefined {
  return layout.grid.items.find((item) => item.slot === slot);
}

describe('governance demo resolution', () => {
  it('locks only the header at the default level — metrics is free until the org publishes', () => {
    const effective = resolveLayout({ default: defaultLevel });
    expect(effective.lockedSlots).toEqual(['header']);
    expect(effective.lockedSlots).not.toContain(ORG_LOCKED_SLOT);
  });

  it('adds the org metrics lock and adopts the org body layout once published', () => {
    const effective = resolveLayout({ default: defaultLevel, org: orgLevel });
    // Both the default-level header lock and the org-added metrics lock apply.
    expect(effective.lockedSlots).toEqual(['header', 'metrics']);
    // The org standard widens the metrics chart (default is 6 wide, org is 8).
    expect(bySlot(effective.layout, 'metrics')?.w).toBe(8);
  });

  it('lets the user move the free notes slot but never the org-locked metrics', () => {
    // The user forks a personal copy and moves notes; they also attempt to move
    // the locked metrics chart — a lower level can't override a slot locked above.
    const userLayout: LayoutPage = {
      ...ORG_PUBLICATION.layout,
      default: false,
      name: 'Alice personal',
      grid: {
        items: ORG_PUBLICATION.layout.grid.items.map((item) =>
          item.slot === 'notes'
            ? { ...item, x: 0, y: 5, w: 12 }
            : item.slot === 'metrics'
              ? { ...item, x: 0, y: 2, w: 4 } // attempted (must be ignored)
              : item,
        ),
      },
    };
    const effective = resolveLayout({ default: defaultLevel, org: orgLevel, user: { layout: userLayout } });

    // The user's notes move wins (free slot).
    expect(bySlot(effective.layout, 'notes')).toMatchObject({ x: 0, y: 5, w: 12 });
    // The org-locked metrics keeps the org's geometry — the user edit is governed away.
    expect(bySlot(effective.layout, 'metrics')?.w).toBe(8);
    expect(effective.lockedSlots).toEqual(['header', 'metrics']);
  });
});
