import { expect, test } from '@playwright/test';

/**
 * The acknowledged-sideload flow (SPEC §4, FR-8, issue #12 acceptance) — driven
 * against `vite dev` with the dev gate on and the stand-in acknowledged widget
 * server (playwright.config.ts, `chromium-dev` project). It exercises the whole
 * path: an owner registers a remote **by URL** with an explicit acknowledgement →
 * the registration is **persisted** by the demo API (its content hash pinned at
 * registration) → the remote appears as a picker entry carrying the **distinct**
 * acknowledged badge → placing it mounts it, hash-verified, with the badge on the
 * card → the registration **survives a reload** (unlike dev sideload's session-only
 * allowlist) → and a **tampered** remote whose bytes no longer match the pin is
 * **refused** on load, with telemetry.
 *
 * These two tests share the demo API + the tamper toggle, so they run serially and
 * clean up their registrations after each.
 */
test.describe.configure({ mode: 'serial' });

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
const ACK_ORIGIN = `http://localhost:${process.env.GM_E2E_ACK_WIDGET_PORT ?? '6071'}`;
const TELEMETRY_PREFIX = '[gridmason:sideload]';

test.afterEach(async ({ page }) => {
  // Reset the tamper toggle and drop every registration so the shared demo API +
  // fixture return to a clean state for the next test / parallel spec.
  await page.request.post(`${ACK_ORIGIN}/__reset`).catch(() => undefined);
  const res = await page.request.get('/api/sideload').catch(() => undefined);
  if (res?.ok()) {
    const { registrations } = (await res.json()) as { registrations: { url: string }[] };
    for (const { url } of registrations) {
      await page.request.delete(`/api/sideload?url=${encodeURIComponent(url)}`).catch(() => undefined);
    }
  }
});

/** Open the add-widget picker on the home page in edit mode. */
async function openPicker(page: import('@playwright/test').Page) {
  const canvas = page.locator(CANVAS);
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await expect(page.getByText('Editing layout')).toBeVisible();
  await page.getByRole('button', { name: 'Add widget' }).click();
  const picker = page.getByRole('dialog', { name: 'Add widget' });
  await expect(picker).toBeVisible();
  return picker;
}

/** Register + acknowledge the stand-in remote through the picker. */
async function register(picker: import('@playwright/test').Locator) {
  await picker.getByLabel('Acknowledged remote URL').fill(ACK_ORIGIN);
  await picker.getByLabel('Acknowledge unreviewed code').check();
  await picker.getByRole('button', { name: 'Acknowledge remote' }).click();
  const card = picker.locator('.gm-sl-card', { hasText: 'Acked Notes' });
  await expect(card).toBeVisible();
  return card;
}

test('registers by URL + acknowledgement, mounts with the distinct badge, and persists across reload', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.locator(CANVAS);

  const picker = await openPicker(page);
  const card = await register(picker);

  // The picker entry carries the distinct acknowledged badge (not the dev badge).
  await expect(card.locator('.gm-ack-badge')).toBeVisible();
  await expect(card.locator('.gm-sideload-badge')).toHaveCount(0);

  // Place it — the remote hot-loads onto the governed canvas, hash-verified.
  await card.click();
  await expect(picker).toBeHidden();
  await expect(canvas.getByTestId('ack-note')).toHaveText('Acknowledged Notes');
  // The mounted card is marked distinctly (badge on the card too — SPEC §4).
  await expect(canvas.locator('.grid-stack-item .gm-ack-badge')).toBeVisible();

  // Persistent: a reload drops the (unsaved) placement, but the registration — which
  // was recorded server-side — survives, so the picker still lists the remote.
  await page.reload();
  await expect(canvas.locator('.grid-stack-item')).toHaveCount(4);
  await expect(canvas.getByTestId('ack-note')).toHaveCount(0);
  const reopened = await openPicker(page);
  await expect(reopened.locator('.gm-sl-card', { hasText: 'Acked Notes' })).toBeVisible();
});

test('refuses to mount a tampered remote whose content no longer matches its pin', async ({ page }) => {
  const telemetry: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes(TELEMETRY_PREFIX)) telemetry.push(message.text());
  });

  await page.goto('/');
  const canvas = page.locator(CANVAS);

  // Register (pins the good content), then tamper the served entry bytes.
  const picker = await openPicker(page);
  await register(picker);
  const tamper = await page.request.post(`${ACK_ORIGIN}/__tamper`);
  expect(tamper.ok()).toBe(true);

  // Placing now fetches the tampered entry: its hash no longer matches the pin, so
  // the load is refused — the widget never mounts and the picker surfaces the error.
  await picker.locator('.gm-sl-card', { hasText: 'Acked Notes' }).click();
  await expect(picker.locator('.gm-sl-error')).toBeVisible();
  await expect(picker).toBeVisible(); // stayed open — the place did not complete
  await expect(canvas.getByTestId('ack-note')).toHaveCount(0);

  // The refusal emitted hash-mismatch telemetry.
  expect(telemetry.some((line) => line.includes('does not match pin'))).toBe(true);
});
