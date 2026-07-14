import { expect, test } from '@playwright/test';

/**
 * Boot smoke test (FR-1, FR-16): the app boots and every route mounts core's
 * page canvas — no special-case page component. The canvas is empty at this
 * stage (core 0.1.0 ships `<gm-page-canvas>` as a placeholder); this test
 * asserts the host renders it with the canonical accessible name from
 * mockup 01-canvas.html, which is the invariant later epics build on.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';

test('root route mounts the page canvas host', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator(CANVAS);
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute('page-type', 'dashboards.home');
});

test('a page-type route mounts the same canvas host with its page type', async ({ page }) => {
  await page.goto('/p/demo.record-detail/cust-42');
  const canvas = page.locator(CANVAS);
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute('page-type', 'demo.record-detail');
  await expect(canvas).toHaveAttribute('entity-id', 'cust-42');
});
