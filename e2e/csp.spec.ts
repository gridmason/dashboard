import { expect, test, type Page } from '@playwright/test';

/**
 * The production CSP report-only run (SPEC §3, FR-13) — acceptance criterion 1.
 * `vite preview` serves the enforced production policy as
 * `Content-Security-Policy-Report-Only` (`vite/production-csp.ts`), so driving the
 * real built bundle through every demo flow must produce **zero** violations
 * before the same policy is enforced in production (`docker/nginx.conf`). A
 * violation here means the strict policy would break that flow when enforced.
 *
 * Runs in the production-parity `chromium` project (the `vite preview` bundle,
 * sideload posture `off`). Violations are collected two ways for robustness: the
 * `securitypolicyviolation` DOM event (installed before any page script) and the
 * `[Report Only]` console errors Chromium emits.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';

interface CspViolation {
  readonly directive: string;
  readonly blockedURI: string;
}

/**
 * Install two report-only violation collectors on `page`: a `securitypolicyviolation`
 * DOM listener (added before any page script runs, survives navigation) and a
 * mirror of the `[Report Only]` console errors Chromium emits. Returns the live
 * console array; read the DOM ones with {@link allViolations}.
 */
async function collectViolations(page: Page): Promise<CspViolation[]> {
  const consoleViolations: CspViolation[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && /content security policy/i.test(text)) {
      consoleViolations.push({ directive: 'console', blockedURI: text });
    }
  });
  await page.addInitScript(() => {
    const store: { directive: string; blockedURI: string }[] = [];
    (window as unknown as { __csp: typeof store }).__csp = store;
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push({
        directive: event.effectiveDirective || event.violatedDirective,
        blockedURI: event.blockedURI,
      });
    });
  });
  return consoleViolations;
}

/** Every collected violation: the console mirror plus the page's DOM-event store. */
async function allViolations(page: Page, consoleViolations: CspViolation[]): Promise<CspViolation[]> {
  const dom = await page.evaluate(() => (window as unknown as { __csp?: CspViolation[] }).__csp ?? []);
  return [...consoleViolations, ...dom];
}

test.describe('production CSP report-only run is clean', () => {
  test('the preview server serves the report-only production policy', async ({ page }) => {
    const response = await page.goto('/');
    const header = response?.headers()['content-security-policy-report-only'];
    expect(header, 'preview must serve the report-only production CSP').toBeTruthy();
    expect(header).toContain("script-src 'self'");
    expect(header).toContain("connect-src 'self'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("frame-ancestors 'none'");
    // The strict production policy never grants script the dev relaxations.
    expect(header).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  const flows: readonly { readonly name: string; readonly path: string }[] = [
    { name: 'boot dashboards.home (+ error boundary)', path: '/' },
    { name: 'boot demo.record-detail (context widget)', path: '/p/demo.record-detail/cust-42' },
    { name: 'boot demo.locked', path: '/p/demo.locked' },
    { name: 'boot demo.full-canvas', path: '/p/demo.full-canvas' },
    { name: 'governance page', path: '/p/demo.record-detail/gov-demo' },
  ];

  for (const { name, path } of flows) {
    test(`no CSP violation across: ${name}`, async ({ page }) => {
      const consoleViolations = await collectViolations(page);
      await page.goto(path);
      // Let the canvas boot, the SW register, widgets lazily import, and gridstack
      // set its inline styles — the surfaces most likely to trip script/style/worker.
      await expect(page.locator(CANVAS)).toHaveCount(1);
      await expect(page.locator(CANVAS).locator('.grid-stack-item').first()).toBeVisible();
      await page.waitForTimeout(300);
      expect(await allViolations(page, consoleViolations)).toEqual([]);
    });
  }

  test('no CSP violation entering edit mode (the picker surface) or retrying a widget', async ({ page }) => {
    const consoleViolations = await collectViolations(page);
    await page.goto('/');
    await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(4);

    // Edit mode is the add-widget/picker surface; the crasher's fallback offers Retry.
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await expect(page.getByText('Editing layout')).toBeVisible();

    const fallback = page.locator(CANVAS).locator('.gm-widget-fallback');
    await expect(fallback).toHaveCount(1);
    await fallback.getByRole('button', { name: 'Retry' }).click();
    await page.waitForTimeout(200);

    expect(await allViolations(page, consoleViolations)).toEqual([]);
  });

  test('no CSP violation on the sideload-gate flow (registered remote blocked by off posture)', async ({ page }) => {
    const consoleViolations = await collectViolations(page);
    // Answer the registrations endpoint as if acknowledged mode were on; the off
    // posture must ignore it, and doing so must not trip the CSP either.
    await page.route('**/api/sideload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'acknowledged',
          registrations: [
            { url: 'https://blocked.example/w.json', origin: 'https://blocked.example', hash: 'sha256-x', acknowledgedBy: 'alice', at: '2026-01-01T00:00:00Z' },
          ],
          scriptSrc: ['https://blocked.example'],
        }),
      });
    });
    await page.goto('/');
    await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(4);
    await page.waitForTimeout(300);
    expect(await allViolations(page, consoleViolations)).toEqual([]);
  });
});
