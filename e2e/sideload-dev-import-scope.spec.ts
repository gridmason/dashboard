import { expect, test } from '@playwright/test';

/**
 * The dev-sideload `@gridmason/*` import scope (SPEC §4, issue #40) — driven
 * against `vite dev` with the dev gate on and a stand-in `gridmason dev` server
 * whose widget entry imports `@gridmason/sdk` **and** `@gridmason/protocol` by
 * **bare specifier** (`e2e/fixtures/dev-widget-server-sdk.mjs`).
 *
 * Before this issue such a widget threw `Failed to resolve module specifier
 * "@gridmason/sdk"` when the dashboard `import()`d its entry, because the dashboard
 * provided no shared scope for a sideloaded module. Now the dev server injects the
 * `@gridmason/*` import map (`vite/dev-sideload-import-scope.ts`), so the bare
 * specifiers resolve to the dashboard's pinned copies and the widget mounts. The
 * element upgrading at all proves the imports resolved (an unresolved bare
 * specifier would abort the module before `customElements.define`); the rendered
 * `SDK import ok` further asserts the imported symbols are the real runtime exports.
 *
 * The test never Saves, so it writes nothing to the shared demo API.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
// Tracks the bare-specifier stand-in server's port (playwright.config.ts).
const DEV_ORIGIN = `http://localhost:${process.env.GM_E2E_SDK_WIDGET_PORT ?? '6072'}`;

test('a scaffold-style widget importing @gridmason/* by bare specifier hot-loads and mounts', async ({
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

  // Register the dev-server origin — its widget appears as a badged picker entry.
  await picker.getByLabel('Dev server origin').fill(DEV_ORIGIN);
  await picker.getByRole('button', { name: 'Register', exact: true }).click();
  const card = picker.locator('.gm-sl-card', { hasText: 'SDK Note' });
  await expect(card).toBeVisible();
  await expect(card.locator('.gm-sideload-badge')).toBeVisible();

  // Place it — the bare-specifier entry resolves `@gridmason/*` through the injected
  // import map and mounts. `SDK import ok` proves both imports resolved to the real
  // runtime exports.
  await card.click();
  await expect(picker).toBeHidden();
  await expect(canvas.getByTestId('sdk-note')).toHaveText('SDK import ok');

  // The mounted card is marked distinctly (SPEC §4: badge on the card too).
  await expect(canvas.locator('.grid-stack-item .gm-sideload-badge')).toBeVisible();
});
