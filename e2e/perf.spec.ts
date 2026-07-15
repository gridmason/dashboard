import { expect, test, type Page } from '@playwright/test';
import { CANVAS_INTERACTIVE_BUDGET_MS } from '../src/adapters/telemetry/budget';

/**
 * Canvas-interactive perf NFR (FR-16; SPEC §7): **p95 canvas interactive < 300 ms
 * after data**. Core's `CanvasPerfMarker` times the data→interactive window — from
 * the resolved layout being assigned to the grid becoming interactive — and emits
 * it as a `canvas.interactive` telemetry event the dashboard adapter records. The
 * adapter's console exporter prints that measurement, so this spec reads the
 * duration back off the telemetry stream and asserts it is inside the budget: a
 * regression that pushes canvas-interactive over 300 ms fails CI.
 *
 * (The marker also records a `gm:canvas-interactive` User Timing measure for a
 * devtools trace, but core clears it immediately after recording — so the durable
 * measurement a CI gate reads is the telemetry event, which is what we assert.)
 *
 * Remote fetch stays off the critical path (lazy activation), so the measured
 * window is the synchronous grid build, not any widget's data load.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
const CANVAS_INTERACTIVE = /canvas\.interactive (\d+(?:\.\d+)?)ms/;

interface PerfCase {
  readonly pageType: string;
  readonly path: string;
}

/** The healthy page types (a degrade demo's laggard never settles, so it is excluded). */
const PAGES: readonly PerfCase[] = [
  { pageType: 'dashboards.home', path: '/' },
  { pageType: 'demo.record-detail', path: '/p/demo.record-detail/cust-42' },
  { pageType: 'demo.locked', path: '/p/demo.locked' },
  { pageType: 'demo.full-canvas', path: '/p/demo.full-canvas' },
];

/** Collect every `canvas.interactive` duration (ms) the telemetry console stream reports. */
function collectInteractiveMs(page: Page): number[] {
  const durations: number[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('[gridmason:telemetry]')) return;
    const match = CANVAS_INTERACTIVE.exec(text);
    if (match !== null) durations.push(Number(match[1]));
  });
  return durations;
}

test.describe('canvas-interactive perf budget (< 300 ms after data)', () => {
  for (const { pageType, path } of PAGES) {
    test(`${pageType} renders interactive inside the ${CANVAS_INTERACTIVE_BUDGET_MS} ms budget`, async ({
      page,
    }) => {
      const durations = collectInteractiveMs(page);
      await page.goto(path);
      const canvas = page.locator(CANVAS);
      await expect(canvas).toHaveCount(1);
      await expect(canvas.locator('.grid-stack-item').first()).toBeVisible();

      // The canvas emitted at least one interactive measurement (the perfTelemetry
      // wiring is live), and every measurement is inside the p95 budget.
      await expect.poll(() => durations.length, { timeout: 5000 }).toBeGreaterThan(0);
      const worst = Math.max(...durations);
      expect(worst, `canvas.interactive samples: ${durations.join(', ')}ms`).toBeLessThan(
        CANVAS_INTERACTIVE_BUDGET_MS,
      );
    });
  }
});
