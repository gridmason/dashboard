import { expect, test } from '@playwright/test';

/**
 * The sideload build-mode gate, at the UI level (SPEC §4, issue #11 acceptance):
 * dev sideload ships in **development builds only**. This spec runs against the
 * built **production** bundle (`vite preview`), so the dev-only author-loop
 * surface must be entirely absent — no Add-widget affordance, even in edit mode.
 * The bundle-level proof (no dev-sideload code/CSS in `dist/`) is the companion
 * `src/sideload/production-gate.test.ts`.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';

test('the dev-sideload Add-widget affordance is absent in a production build', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(4);

  // Enter edit mode — where the dev build would surface the sideload picker.
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await expect(page.getByText('Editing layout')).toBeVisible();

  // The dev-only Add-widget button and any sideload badge must not exist.
  await expect(page.getByRole('button', { name: 'Add widget' })).toHaveCount(0);
  await expect(page.locator('.gm-sideload-badge')).toHaveCount(0);
});
