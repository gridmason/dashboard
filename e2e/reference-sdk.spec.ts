import { expect, test } from '@playwright/test';

/**
 * Reference SDK handle wiring (FR-9/FR-14, D-E4 — docs/SPEC.md §6, §3, §2).
 *
 * Proves, against the real built bundle, what the `host-sdk/` unit + conformance
 * tests assert in isolation: the canvas glue mints one **distinct per-instance**
 * enforcing reference handle per mounted widget (SPEC §3 rule 5) and assigns it
 * onto the widget element's `sdk` property, and a record-scoped page's handle
 * reads its context record back **through** `sdk.records.read` — the read passing
 * the handle's `min(user, widget)` gate (the page's context declares the customer
 * read; the single-tenant owner grants it). The first-party demo widgets (#6) do
 * not yet consume the handle themselves — record-summary's SDK read-path is
 * deferred — so this reads it off the element directly, the way a context consumer
 * will once that seam lands. Only the healthy demo widgets are counted: the home
 * page's deliberate crasher stays in its error state, so the canvas never mounts it
 * and it never receives a handle.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
// The healthy first-party demo widgets (import-map `WIDGET_TAGS`), excluding the
// crasher — every one of these mounts and so receives a per-instance handle.
const WIDGET = 'gm-clock-widget, gm-markdown-widget, gm-chart-widget, gm-record-summary-widget';

/** Wait until the host has assigned a handle onto the first mounted widget element. */
async function waitForHandles(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction((tag) => {
    const el = document.querySelector(tag) as unknown as { sdk?: { identity?: { instanceId?: string } } } | null;
    return typeof el?.sdk?.identity?.instanceId === 'string';
  }, WIDGET);
}

test('each mounted widget gets a distinct per-instance handle', async ({ page }) => {
  await page.goto('/'); // dashboards.home places clock + markdown + chart (+ a crasher that errors)
  await expect(page.locator(CANVAS)).toHaveCount(1);
  await expect(page.locator(WIDGET)).toHaveCount(3); // three healthy widgets mount; the crasher does not
  await waitForHandles(page);

  const identities = await page.evaluate((tag) => {
    return Array.from(document.querySelectorAll(tag)).map((el) => {
      const sdk = (el as unknown as { sdk?: { identity?: { instanceId?: string } } }).sdk;
      return sdk?.identity?.instanceId ?? null;
    });
  }, WIDGET);

  expect(identities).toHaveLength(3);
  expect(identities.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  expect(new Set(identities).size).toBe(3); // all distinct — two mounts never share an identity
});

test('a record-scoped widget reads its context record through the handle', async ({ page }) => {
  await page.goto('/p/demo.record-detail/cust-42');
  await expect(page.locator(CANVAS)).toHaveCount(1);
  await expect(page.locator(WIDGET)).toHaveCount(3);
  await waitForHandles(page);

  const record = await page.evaluate(async (tag) => {
    const el = document.querySelector(tag) as unknown as {
      sdk?: {
        context?: { record?: { recordType: string; id: string } };
        records: { read: (ref: unknown) => Promise<{ ref: unknown; fields: Record<string, unknown> }> };
      };
    } | null;
    const sdk = el?.sdk;
    const ref = sdk?.context?.record;
    if (sdk === undefined || ref === undefined) return null;
    const result = await sdk.records.read(ref);
    return { ref: result.ref, name: String(result.fields.name ?? '') };
  }, WIDGET);

  expect(record).not.toBeNull();
  expect(record!.ref).toEqual({ recordType: 'customer', id: 'cust-42' });
  expect(record!.name).toContain('cust-42');
});
