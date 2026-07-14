import { expect, test } from '@playwright/test';

/**
 * Boot smoke test (FR-1, FR-2, FR-16): the app boots and every route renders
 * core's `PageCanvas` — no special-case page component — and each of the four
 * demo page types renders its default layout through that one canvas, driven
 * from the local import map (SPEC §2, §5). The canvas is located by the
 * canonical accessible name from mockup 01-canvas.html; a rendered layout is
 * asserted by the gridstack items it places and the placeholder widget the
 * import map lazily loads into them.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';

interface PageTypeCase {
  readonly pageType: string;
  readonly path: string;
  readonly widgets: number;
  readonly entityId?: string;
}

/** Each demo page type, its route, and how many widgets its default layout places. */
const PAGE_TYPES: readonly PageTypeCase[] = [
  { pageType: 'dashboards.home', path: '/', widgets: 4 },
  { pageType: 'demo.record-detail', path: '/p/demo.record-detail/cust-42', widgets: 3, entityId: 'cust-42' },
  { pageType: 'demo.locked', path: '/p/demo.locked', widgets: 3 },
  { pageType: 'demo.full-canvas', path: '/p/demo.full-canvas', widgets: 1 },
] as const;

for (const { pageType, path, widgets, entityId } of PAGE_TYPES) {
  test(`boots ${pageType} and renders its default layout via PageCanvas`, async ({ page }) => {
    await page.goto(path);

    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute('data-page-type', pageType);
    if (entityId !== undefined) {
      await expect(canvas).toHaveAttribute('data-entity-id', entityId);
    }

    // The layout rendered: gridstack placed every item, and the import map
    // lazily loaded the widget into each one.
    await expect(canvas.locator('.grid-stack-item')).toHaveCount(widgets);
    await expect(canvas.locator('.gm-placeholder').first()).toBeVisible();
  });
}

test('demo.full-canvas maximizes its single locked widget across the canvas', async ({ page }) => {
  await page.goto('/p/demo.full-canvas');
  const canvas = page.locator(CANVAS);
  const item = canvas.locator('.grid-stack-item');
  await expect(item).toHaveCount(1);
  // The one widget fills the canvas width — the "maximized" trait of this page
  // type, and a guard on the grid actually resolving its full width on mount.
  await expect
    .poll(
      async () => {
        const c = await canvas.boundingBox();
        const i = await item.boundingBox();
        return c && i && c.width > 0 ? i.width / c.width : 0;
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(0.8);
});
