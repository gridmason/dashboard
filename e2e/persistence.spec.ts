import { expect, test } from '@playwright/test';

/**
 * Layout persistence + copy-on-write (FR-5, SPEC §5/§6). A user edit persists
 * through the demo API and survives a full reload; **Reset to org default**
 * removes the user override so the page falls back to the org/default layout —
 * and, because the override lived under `user:<id>` and the default was never
 * written, resetting proves the default document was never mutated.
 *
 * The edit is driven by dispatching the canvas's settled-drag/resize event
 * (`gm:geometry-change`) that a real gridstack pointer edit fires — the same
 * signal core's edit controller folds into the layout and persists — so the test
 * exercises the actual persistence path without simulating raw pointer physics.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
const HOME_STORE_PATH = '/api/layouts/user:alice/dashboards.home';

/** The rendered grid width (columns) of a placed widget, read back from the canvas. */
function widthOf(page: import('@playwright/test').Page, instanceId: string): Promise<number | undefined> {
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

test('user edit persists through the demo API and survives reload; reset restores the default', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator(CANVAS);
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);
  // The default `dashboards.home` layout places the clock 3 columns wide.
  await expect.poll(() => widthOf(page, 'clock')).toBe(3);

  // Enter edit mode and widen the clock to 6 columns.
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await expect(page.getByText('Editing layout')).toBeVisible();
  await resizeClock(page, 6);

  // The edit is staged (dirty) — Save enables — then committed.
  const save = page.getByRole('button', { name: 'Save layout' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Editing layout')).toBeHidden();

  // Persisted through the API under the user scope, not the default.
  const stored = await page.evaluate(async (path) => {
    const res = await fetch(path, { credentials: 'include' });
    return res.ok ? await res.json() : null;
  }, HOME_STORE_PATH);
  expect(stored).not.toBeNull();
  expect((stored.grid.items as { i: string; w: number }[]).find((it) => it.i === 'clock')?.w).toBe(6);

  // Survives a full reload: the page renders the override, not the default.
  await page.reload();
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);
  await expect.poll(() => widthOf(page, 'clock')).toBe(6);

  // Reset to org default removes the user override.
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.getByRole('button', { name: 'Reset to org default' }).click();
  await expect(page.getByText('Editing layout')).toBeHidden();

  // The override is gone from the store — the default document was never mutated.
  const statusAfterReset = await page.evaluate(async (path) => {
    const res = await fetch(path, { credentials: 'include' });
    return res.status;
  }, HOME_STORE_PATH);
  expect(statusAfterReset).toBe(404);

  // And the page falls back to the default layout across a reload.
  await page.reload();
  await expect.poll(() => widthOf(page, 'clock')).toBe(3);
});
