import { expect, test } from '@playwright/test';

/**
 * The dev-sideload author loop (SPEC §4, FR-7, issue #11 acceptance) — driven
 * against `vite dev` with the dev gate on and the stand-in `gridmason dev` widget
 * server (playwright.config.ts, `chromium-dev` project). Exercises the full path
 * end to end: register a dev origin → the widget hot-loads onto the governed page
 * through the same mount path as a first-party widget → it carries the distinct
 * sideload badge on both the picker entry and the mounted card → re-serving
 * updates a fresh mount → and the allowlist is per-session (nothing persisted:
 * a reload clears it).
 *
 * The test never Saves, so it writes nothing to the shared demo API — it stays
 * independent of the persistence/governance specs running in parallel.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
// Tracks the stand-in dev-widget server's port (playwright.config.ts).
const DEV_ORIGIN = `http://localhost:${process.env.GM_E2E_WIDGET_PORT ?? '6070'}`;

test('a gridmason dev widget hot-loads with a badge, re-serves, and is gone after reload', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.locator(CANVAS);
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);

  // Enter the governed edit loop and open the dev add-widget picker.
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await expect(page.getByText('Editing layout')).toBeVisible();
  await page.getByRole('button', { name: 'Add widget' }).click();
  const picker = page.getByRole('dialog', { name: 'Add widget' });
  await expect(picker).toBeVisible();

  // Owner acknowledgement (SPEC §4): dev sideload unlocks only by explicit accept.
  await picker.getByRole('button', { name: /enable dev sideload/i }).click();

  // Register the dev-server origin — its widget appears as a picker entry, badged.
  await picker.getByLabel('Dev server origin').fill(DEV_ORIGIN);
  await picker.getByRole('button', { name: 'Register' }).click();
  const card = picker.locator('.gm-sl-card', { hasText: 'Field Notes' });
  await expect(card).toBeVisible();
  await expect(card.locator('.gm-sideload-badge')).toBeVisible();

  // Place it — the dev remote hot-loads onto the governed canvas.
  await card.click();
  await expect(picker).toBeHidden();
  await expect(canvas.getByTestId('dev-note')).toHaveText('Field Notes v1');

  // The mounted card is marked distinctly (SPEC §4: badge on the card too).
  await expect(canvas.locator('.grid-stack-item .gm-sideload-badge')).toBeVisible();

  // Re-serve (the author-loop edit): a fresh mount reflects the new content.
  await page.request.post(`${DEV_ORIGIN}/__bump`);
  await page.getByRole('button', { name: 'Add widget' }).click();
  await picker.locator('.gm-sl-card', { hasText: 'Field Notes' }).click();
  await expect(canvas.getByTestId('dev-note').filter({ hasText: 'Field Notes v2' })).toBeVisible();

  // Per-session, nothing persisted: a reload clears the allowlist and the widget.
  await page.reload();
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);
  await expect(canvas.getByTestId('dev-note')).toHaveCount(0);
  // Re-opening the picker shows no admitted remotes — the session allowlist is empty.
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.getByRole('button', { name: 'Add widget' }).click();
  await picker.getByRole('button', { name: /enable dev sideload/i }).click();
  await expect(picker.getByText('No dev remotes admitted this session')).toBeVisible();

  // Nothing was written to persistent storage.
  const persisted = await page.evaluate(() => ({
    local: window.localStorage.length,
    session: window.sessionStorage.length,
  }));
  expect(persisted).toEqual({ local: 0, session: 0 });
});
