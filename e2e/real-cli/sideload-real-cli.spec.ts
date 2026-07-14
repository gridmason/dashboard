import { expect, test } from '@playwright/test';

/**
 * The real-CLI dev-sideload author loop (issue #38 — closes issue #11's deferred
 * acceptance criterion). Unlike `sideload-dev.spec.ts` (which drives a hermetic
 * stand-in), this runs against the **real** `@gridmason/cli dev` serving
 * `e2e/fixtures/real-cli-widget/` (playwright.real-cli.config.ts). It proves the
 * dashboard admits and mounts a widget the real dev server serves — over the real
 * contract the seam was reconciled to (`/@dev/manifest` for tag+entry, raw
 * `/manifest.json` for the display name).
 *
 * Run it deliberately: `npm run e2e:real-cli` (non-hermetic — it downloads the
 * published CLI). It is excluded from the default matrix.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
const CLI_ORIGIN = `http://127.0.0.1:${process.env.GM_E2E_REAL_CLI_PORT ?? '6090'}`;

test('a widget served by real `gridmason dev` hot-loads with a badge on a governed page', async ({
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

  // Register the REAL dev-server origin. The seam reads /@dev/manifest for the
  // validated tag + entry and the raw /manifest.json for the display name.
  await picker.getByLabel('Dev server origin').fill(CLI_ORIGIN);
  await picker.getByRole('button', { name: 'Register', exact: true }).click();
  const card = picker.locator('.gm-sl-card', { hasText: 'selfnote' });
  await expect(card).toBeVisible();
  await expect(card.locator('.gm-sideload-badge')).toBeVisible();

  // Place it — the real dev remote hot-loads onto the governed canvas.
  await card.click();
  await expect(picker).toBeHidden();
  await expect(canvas.getByTestId('self-note')).toHaveText('Self Note v1');

  // The mounted card is marked distinctly (SPEC §4: badge on the card too).
  await expect(canvas.locator('.grid-stack-item .gm-sideload-badge')).toBeVisible();

  // Per-session, nothing persisted: a reload clears the allowlist and the widget.
  await page.reload();
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);
  await expect(canvas.getByTestId('self-note')).toHaveCount(0);
});
