import { expect, test } from '@playwright/test';

/**
 * Telemetry + auto-degrade end to end (FR-15; SPEC §3, §7). The `demo.telemetry`
 * page places two healthy widgets beside the two degrade demos: the **crasher**
 * (throws on mount → an *error* degrade) and the **laggard** (declares itself
 * pending and never becomes interactive → a *latency-budget* degrade). This proves
 * the FR-15 contract:
 *
 * - a **budget-busting widget auto-degrades** to its fallback card, and
 * - the degrade is **attributed to that widget instance** — the console telemetry
 *   exporter names the `(source/tag#instance)` on the `widget.latency` `exceeded`
 *   line (`[gridmason:telemetry] … auto-degraded`), which is the host-visible flag.
 *
 * The healthy widgets keep rendering throughout — one widget's budget breach never
 * takes the page down (the shell never blocks on widget code).
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
const TELEMETRY_PATH = '/p/demo.telemetry';

test.describe('telemetry + auto-degrade on demo.telemetry', () => {
  test('auto-degrades the budget-busting laggard to its fallback, attributed', async ({ page }) => {
    // Capture the console telemetry stream before boot: the console exporter is the
    // default sink (SPEC §6), so an auto-degrade surfaces here with attribution.
    const telemetryLines: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[gridmason:telemetry]')) telemetryLines.push(text);
    });

    await page.goto(TELEMETRY_PATH);
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveAttribute('data-page-type', 'demo.telemetry');
    await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);

    // The crasher degrades immediately (error boundary trips on mount).
    const fallbacks = canvas.locator('.gm-widget-fallback');
    await expect(fallbacks.filter({ hasText: 'Crasher' })).toHaveCount(1);

    // The laggard blows its latency budget and is auto-degraded to its fallback
    // card — named by its descriptor ("Slow widget"). The budget is generous
    // (WIDGET_LATENCY_BUDGET_MS = 1500 ms), so allow ample time.
    const laggardFallback = fallbacks.filter({ hasText: 'Slow widget' });
    await expect(laggardFallback).toHaveCount(1, { timeout: 8000 });
    await expect(laggardFallback.getByRole('button', { name: 'Retry' })).toBeVisible();

    // Both degrades are isolated: the two healthy widgets rendered and stayed up.
    await expect(canvas.locator('.gm-clock')).toBeVisible();
    await expect(canvas.locator('.gm-chart')).toBeVisible();

    // The auto-degrade was attributed to the laggard instance on the telemetry
    // stream (the host-side flag): a `widget.latency` EXCEEDED line naming the
    // widget tag and the instance id it was placed at.
    const attributed = telemetryLines.find(
      (line) =>
        line.includes('widget.latency') &&
        line.includes('gm-laggard-widget#laggard') &&
        line.includes('auto-degraded'),
    );
    expect(attributed, `telemetry lines seen:\n${telemetryLines.join('\n')}`).toBeTruthy();
  });

  test('a degraded widget can be retried and the page never blocks on it', async ({ page }) => {
    await page.goto(TELEMETRY_PATH);
    const canvas = page.locator(CANVAS);
    const laggardFallback = canvas.locator('.gm-widget-fallback').filter({ hasText: 'Slow widget' });
    await expect(laggardFallback).toHaveCount(1, { timeout: 8000 });

    // Retry re-runs the mount lifecycle; the laggard still never settles, so it
    // degrades again — the control is live and the rest of the page is untouched.
    await laggardFallback.getByRole('button', { name: 'Retry' }).click();
    await expect(canvas.locator('.gm-widget-fallback').filter({ hasText: 'Slow widget' })).toHaveCount(1, {
      timeout: 8000,
    });
    await expect(canvas.locator('.gm-clock')).toBeVisible();
  });
});
