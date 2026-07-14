import { expect, test } from '@playwright/test';

/**
 * Per-widget error-boundary demo (FR-3, FR-10; SPEC §3, §7). The home page places
 * the deliberate crasher (`gm-crasher-widget`, throws on mount) alongside three
 * healthy first-party widgets. Core's per-widget boundary must isolate the
 * failure: only the crasher's cell shows the fallback card (widget name + Retry),
 * while the clock, notes, and chart still render — the shell never blocks on
 * widget code. Retry re-runs the mount lifecycle (the crasher crashes again, by
 * design), proving the control is live.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';

test.describe('per-widget error boundary on dashboards.home', () => {
  test('isolates the crasher to its own fallback card while siblings render', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator(CANVAS);

    // All four items are placed and their boundaries reconciled.
    await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);

    // Exactly one widget fell back — the crasher — and its card names the widget
    // (host descriptor) and offers Retry.
    const fallback = canvas.locator('.gm-widget-fallback');
    await expect(fallback).toHaveCount(1);
    await expect(fallback.locator('.gm-widget-fallback__title')).toHaveText('Crasher');
    await expect(fallback.getByRole('button', { name: 'Retry' })).toBeVisible();

    // The failure is isolated: three boundaries are ready, one errored.
    await expect(canvas.locator('.gm-widget-boundary[data-gm-state="ready"]')).toHaveCount(3);
    await expect(canvas.locator('.gm-widget-boundary[data-gm-state="error"]')).toHaveCount(1);

    // The rest of the page rendered — the three healthy widgets are visible.
    await expect(canvas.locator('.gm-clock')).toBeVisible();
    await expect(canvas.locator('.gm-markdown')).toBeVisible();
    await expect(canvas.locator('.gm-chart')).toBeVisible();
  });

  test('Retry re-runs the crasher lifecycle and it falls back again', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator(CANVAS);
    const fallback = canvas.locator('.gm-widget-fallback');
    await expect(fallback).toHaveCount(1);

    await fallback.getByRole('button', { name: 'Retry' }).click();

    // The deliberate crasher throws again on re-mount: still exactly one fallback,
    // still errored, and the healthy siblings are untouched.
    await expect(canvas.locator('.gm-widget-fallback')).toHaveCount(1);
    await expect(canvas.locator('.gm-widget-boundary[data-gm-state="error"]')).toHaveCount(1);
    await expect(canvas.locator('.gm-clock')).toBeVisible();
  });
});
