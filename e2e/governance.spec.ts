import { expect, test, type Page } from '@playwright/test';

/**
 * The governance demo end to end (FR-4, SPEC §5) — milestone M-A1. An operator
 * **publishes** an org layout that locks the `metrics` slot; a user then
 * **overrides** the one free slot (`notes`) while the locked slots stay put; and
 * a **reset** returns the page to the published org standard. The 3-level
 * resolution is made visible per mockup 04-governance.html.
 *
 * Two behaviours are proven: (a) publish → override → reset resolves correctly,
 * and (b) a locked slot is immovable in user mode (move and resize blocked). The
 * spec forces serial mode and resets both stores before each case so the shared
 * demo API is deterministic across the two tests.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
const LANE = 'section[aria-label="Three-level layout resolution"]';
const ORG_GOV_PATH = '/api/governance/org/demo.record-detail/gov-demo';
const USER_STORE_PATH = '/api/layouts/user:alice/demo.record-detail/gov-demo';

/** The `(x,y,w,h)` a placed item renders at, read back from the live canvas. */
function geometryOf(page: Page, instanceId: string): Promise<{ x: number; w: number } | undefined> {
  return page.evaluate((id) => {
    const el = document.querySelector('gm-page-canvas') as
      | (HTMLElement & { geometryOf?(i: string): { x: number; w: number } | undefined })
      | null;
    return el?.geometryOf?.(id);
  }, instanceId);
}

/** Dispatch the settled drag/resize event a gridstack pointer edit fires for the given items. */
async function applyGeometry(
  page: Page,
  geometry: readonly { i: string; x: number; y: number; w: number; h: number }[],
): Promise<void> {
  await page.evaluate((geo) => {
    document
      .querySelector('gm-page-canvas')
      ?.dispatchEvent(new CustomEvent('gm:geometry-change', { detail: { geometry: geo } }));
  }, geometry);
}

test.describe.configure({ mode: 'serial' });

test.describe('governance demo', () => {
  test.beforeEach(async ({ page, request }) => {
    // Start each case from a clean slate over the API — deterministic and
    // independent of page boot timing. A fresh admin login (the `request` fixture
    // keeps its own cookie jar) authorizes deleting any prior org publication and
    // user override; a 404 (nothing there) is fine.
    await request.post('/api/auth/login', {
      data: { username: 'alice', password: 'alice-dev-password' },
    });
    await request.delete(ORG_GOV_PATH);
    await request.delete(USER_STORE_PATH);

    await page.goto('/governance');
    // Wait for the app to finish booting before the test acts: the Publish button
    // is *enabled* only once the session is established and the initial (default,
    // un-published) layout has resolved (`ready`). Acting earlier would let the
    // in-flight boot resolution race the publish — a user can't click a disabled
    // button either.
    await expect(page.getByRole('button', { name: 'Publish org layout with locks' })).toBeEnabled();
    await expect.poll(() => geometryOf(page, 'metrics').then((g) => g?.w)).toBe(6);
  });

  test('publish → override the free slot → reset, resolving most-specific-wins', async ({ page }) => {
    const canvas = page.locator(CANVAS);
    await expect(canvas.locator('.grid-stack-item')).toHaveCount(3);

    // Before publish: the org column falls through to the plugin default, whose
    // only lock is the header. The metrics slot is not yet locked.
    const orgMetricsTile = page.locator(`${LANE} > div:nth-child(2) [data-slot="metrics"]`);
    await expect(page.locator(`${LANE} > div:nth-child(2) .gm-lvl-empty`)).toBeVisible();

    // Operator publishes the org standard (which locks metrics and widens it to 8).
    await page.getByRole('button', { name: 'Publish org layout with locks' }).click();
    await expect(page.getByRole('button', { name: 'Unpublish org layout' })).toBeVisible();

    // The three-level view now shows the org layout locking header + metrics.
    await expect(orgMetricsTile).toHaveAttribute('data-locked', 'true');
    await expect(page.locator(`${LANE} > div:nth-child(2) [data-slot="header"]`)).toHaveAttribute('data-locked', 'true');
    await expect(page.locator(`${LANE} > div:nth-child(2) [data-slot="notes"]`)).toHaveAttribute('data-locked', 'false');
    // Effective (user) column mirrors the resolved locks.
    await expect(page.locator(`${LANE} > div:nth-child(3) [data-slot="metrics"]`)).toHaveAttribute('data-locked', 'true');
    // The org standard widened the metrics chart from the default 6 columns to 8.
    await expect.poll(() => geometryOf(page, 'metrics').then((g) => g?.w)).toBe(8);

    // User override: move the free notes slot, and *attempt* to move the locked
    // metrics chart — resolution must apply the first and govern away the second.
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await expect(page.getByText('Editing layout')).toBeVisible();
    await applyGeometry(page, [
      { i: 'notes', x: 0, y: 5, w: 12, h: 2 },
      { i: 'metrics', x: 0, y: 2, w: 4, h: 3 },
    ]);
    const save = page.getByRole('button', { name: 'Save layout' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Editing layout')).toBeHidden();

    // Persisted under the user scope: notes moved to a full-width row; metrics kept
    // the org's locked geometry (the attempted narrow-to-4 was ignored).
    const stored = await page.evaluate(async (path) => {
      const res = await fetch(path, { credentials: 'include' });
      return res.ok ? await res.json() : null;
    }, USER_STORE_PATH);
    expect(stored).not.toBeNull();
    const bySlot = Object.fromEntries(
      (stored.grid.items as { slot: string; x: number; w: number }[]).map((it) => [it.slot, it]),
    );
    expect(bySlot.notes).toMatchObject({ x: 0, w: 12 });
    expect(bySlot.metrics).toMatchObject({ w: 8 }); // locked — never narrowed to 4

    // Survives a reload: the user sees their override, org locks intact.
    await page.reload();
    await expect.poll(() => geometryOf(page, 'notes').then((g) => g?.x)).toBe(0);
    await expect.poll(() => geometryOf(page, 'notes').then((g) => g?.w)).toBe(12);

    // Reset to org default deletes the user override — copy-on-write proven.
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await page.getByRole('button', { name: 'Reset to org default' }).click();
    await expect(page.getByText('Editing layout')).toBeHidden();

    const statusAfterReset = await page.evaluate(async (path) => {
      const res = await fetch(path, { credentials: 'include' });
      return res.status;
    }, USER_STORE_PATH);
    expect(statusAfterReset).toBe(404);

    // The page falls back to the published org standard: notes returns to the org
    // position (x=8), not the user's full-width row — the org doc was never mutated.
    await expect.poll(() => geometryOf(page, 'notes').then((g) => g?.x)).toBe(8);
    await expect.poll(() => geometryOf(page, 'notes').then((g) => g?.w)).toBe(4);
  });

  test('a locked slot is immovable in user mode (move and resize blocked)', async ({ page }) => {
    await page.getByRole('button', { name: 'Publish org layout with locks' }).click();
    await expect(page.getByRole('button', { name: 'Unpublish org layout' })).toBeVisible();
    // Wait for the published org layout to reach the canvas (metrics widened to 8)
    // before editing, so edit mode applies the org locks and not the stale default.
    await expect.poll(() => geometryOf(page, 'metrics').then((g) => g?.w)).toBe(8);

    await page.getByRole('button', { name: 'Edit layout' }).click();
    await expect(page.getByText('Editing layout')).toBeVisible();

    const item = (id: string) => page.locator(`${CANVAS} .grid-stack-item[gs-id="${id}"]`);

    // The org-locked metrics chart and the page-type-locked header are pinned:
    // gridstack marks them non-movable and non-resizable (core renders locked slots
    // non-interactive from the resolved lockedSlots).
    for (const id of ['header', 'metrics']) {
      await expect(item(id)).toHaveAttribute('gs-no-move', 'true');
      await expect(item(id)).toHaveAttribute('gs-no-resize', 'true');
      await expect(item(id)).toHaveClass(/ui-draggable-disabled/);
      await expect(item(id)).toHaveClass(/ui-resizable-disabled/);
    }

    // The free notes slot stays fully editable — the contrast that proves locks are
    // per-slot, not a blanket read-only.
    await expect(item('notes')).not.toHaveAttribute('gs-no-move', 'true');
    await expect(item('notes')).not.toHaveClass(/ui-draggable-disabled/);

    // Behavioural check: a drag/resize reported for the locked metrics slot is
    // folded away, not applied — its geometry is unchanged after the attempt.
    await applyGeometry(page, [{ i: 'metrics', x: 4, y: 2, w: 4, h: 3 }]);
    await expect(page.getByRole('button', { name: 'Save layout' })).toBeDisabled();
    expect(await geometryOf(page, 'metrics')).toMatchObject({ x: 0, w: 8 });
  });
});
