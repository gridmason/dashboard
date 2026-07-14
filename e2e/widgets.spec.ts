import { expect, test } from '@playwright/test';

/**
 * First-party demo widgets exercising the ABI (FR-3; SPEC §5): the context-
 * consuming record-summary reads the page's `record-ref` context, and the
 * schema-validated chart draws inline SVG from its `settings`.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';

test('record-summary renders the record-ref context bound to the route', async ({ page }) => {
  await page.goto('/p/demo.record-detail/cust-42');
  const summary = page.locator(`${CANVAS} .gm-record-summary`);
  await expect(summary).toBeVisible();
  // The typed context the page provided: record kind + the route's entity id.
  await expect(summary.locator('.gm-record-summary__kind')).toHaveText('customer');
  await expect(summary.locator('.gm-record-summary__id')).toHaveText('cust-42');
});

test('record-summary shows an unbound state on an entity-less record route', async ({ page }) => {
  await page.goto('/p/demo.record-detail');
  const summary = page.locator(`${CANVAS} .gm-record-summary`);
  await expect(summary.locator('.gm-record-summary__id')).toHaveText('Unbound record');
});

test('the chart validates its settings and draws inline SVG bars', async ({ page }) => {
  await page.goto('/');
  const chart = page.locator(`${CANVAS} .gm-chart`);
  await expect(chart).toBeVisible();
  await expect(chart.locator('.gm-chart__caption')).toContainText('Sales this month');
  // Four data points → four bar rects, no validation-error panel.
  await expect(chart.locator('.gm-chart__svg .gm-chart__bar')).toHaveCount(4);
  await expect(chart.locator('.gm-chart__invalid')).toHaveCount(0);
});

test('the full-canvas chart maximizes across the grid', async ({ page }) => {
  await page.goto('/p/demo.full-canvas');
  await expect(page.locator(`${CANVAS} .gm-chart__bar`)).toHaveCount(4);
});
