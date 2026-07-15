import { expect, test } from '@playwright/test';

/**
 * The static-demo (serverless) build (issue #78). These run against the built
 * `build:static-demo` bundle served by a plain static file server — no demo API,
 * no dev server. They prove the serverless contract:
 *
 * - the demo pages render from the local import map (Phase-A static boot), and
 * - a layout edit persists in `localStorage` (copy-on-write preserved) and
 *   survives a full reload, with **reset** restoring the default — all while the
 *   page makes **zero** calls to a demo API.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
// The static-demo user is the baked `currentUser` (alice) — src/static-demo/demo-config.json.
const HOME_STORE_KEY = 'gm:demo:layout:user:alice/dashboards.home';

/** The rendered grid width (columns) of a placed widget, read back from the canvas. */
function widthOf(
  page: import('@playwright/test').Page,
  instanceId: string,
): Promise<number | undefined> {
  return page.evaluate((id) => {
    const el = document.querySelector('gm-page-canvas') as
      | (HTMLElement & { geometryOf?(i: string): { w: number } | undefined })
      | null;
    return el?.geometryOf?.(id)?.w;
  }, instanceId);
}

/** Dispatch the settled-resize event a gridstack pointer edit would fire for one item. */
async function resizeClock(page: import('@playwright/test').Page, w: number): Promise<void> {
  await page.evaluate((width) => {
    const el = document.querySelector('gm-page-canvas');
    el?.dispatchEvent(
      new CustomEvent('gm:geometry-change', {
        detail: { geometry: [{ i: 'clock', x: 0, y: 0, w: width, h: 2 }] },
      }),
    );
  }, w);
}

test('renders the demo pages from the local import map with no demo-API calls', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiCalls.push(request.url());
  });

  // Each demo page renders its default layout's widgets (the counts are the page
  // types' default items — src/pages/page-types.ts).
  await page.goto('/');
  await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(4); // home

  await page.goto('/p/demo.record-detail');
  await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(3);

  await page.goto('/p/demo.locked');
  await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(3);

  await page.goto('/p/demo.full-canvas');
  await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(1);

  expect(
    apiCalls,
    `static demo must make no demo-API calls, but saw: ${apiCalls.join(', ')}`,
  ).toHaveLength(0);
});

test('layout edits persist in localStorage and survive reload; reset restores the default', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.locator(CANVAS);
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);
  // The default `dashboards.home` layout places the clock 3 columns wide.
  await expect.poll(() => widthOf(page, 'clock')).toBe(3);

  // Enter edit mode and widen the clock to 6 columns, then Save.
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await expect(page.getByText('Editing layout')).toBeVisible();
  await resizeClock(page, 6);
  const save = page.getByRole('button', { name: 'Save layout' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Editing layout')).toBeHidden();

  // Persisted in localStorage under the user scope (not the default), no network.
  const stored = await page.evaluate((key) => localStorage.getItem(key), HOME_STORE_KEY);
  expect(stored).not.toBeNull();
  const doc = JSON.parse(stored!) as { grid: { items: { i: string; w: number }[] } };
  expect(doc.grid.items.find((item) => item.i === 'clock')?.w).toBe(6);

  // Survives a full reload: the page renders the override, not the default.
  await page.reload();
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);
  await expect.poll(() => widthOf(page, 'clock')).toBe(6);

  // Reset to org default removes the user override from storage...
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.getByRole('button', { name: 'Reset to org default' }).click();
  await expect(page.getByText('Editing layout')).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), HOME_STORE_KEY)).toBeNull();

  // ...and the page falls back to the default layout across a reload — the default
  // document was never mutated (copy-on-write).
  await page.reload();
  await expect.poll(() => widthOf(page, 'clock')).toBe(3);
});
