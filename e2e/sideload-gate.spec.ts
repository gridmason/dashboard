import { expect, test } from '@playwright/test';

/**
 * The sideload gate (SPEC §4, FR-16; issues #11 + #13). Two independent guarantees,
 * both against the built **production** bundle served by `vite preview` (whose
 * client sideload posture is the default `off`):
 *
 * 1. **Dev sideload ships in development builds only** (#11): the dev-only
 *    author-loop surface is entirely absent from a production build — no
 *    Add-widget affordance, even in edit mode. The bundle-level proof (no
 *    dev-sideload code/CSS in `dist/`) is the companion
 *    `src/sideload/production-gate.test.ts`.
 * 2. **`off` is the default and blocks** (#13, FR-16): with the sideload posture
 *    off, an acknowledged remote that is fully *available* to the client is never
 *    fetched, never resolved, and never enters the import map — so nothing mounts
 *    and no acknowledged origin is permitted in `script-src`. Enabling a mode is
 *    required to load one; the enabled path is proven by `sideload-acknowledged`
 *    (the `chromium-dev` project, whose posture is `acknowledged`).
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';

test('the dev-sideload section is absent from the production Add-widget picker', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(4);

  // Enter edit mode — the Add-widget picker is a production surface (#85)…
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await expect(page.getByText('Editing layout')).toBeVisible();
  await page.getByRole('button', { name: 'Add widget' }).click();
  const picker = page.getByRole('dialog', { name: 'Add widget' });
  await expect(picker).toBeVisible();
  await expect(picker.getByText('First-party widgets')).toBeVisible();

  // …but the dev-only sideload section and any sideload badge must not exist.
  await expect(picker.locator('.gm-devsl')).toHaveCount(0);
  await expect(picker.getByText('enable dev sideload')).toHaveCount(0);
  await expect(page.locator('.gm-sideload-badge')).toHaveCount(0);
});

test('with the sideload posture off (default), a registered acknowledged remote never enters the import map', async ({
  page,
}) => {
  // Make an acknowledged registration fully *available* to any client that asks:
  // stub the registrations endpoint to answer as if the deployment were in
  // acknowledged mode with one hash-pinned remote. An acknowledged-enabled client
  // would fetch this, resolve the remote's descriptor from its origin, and merge it
  // into the import map. This production build's posture is the default `off`, so
  // the client must never consult it — the block is at the import-map layer, not a
  // consequence of an empty store.
  const BLOCKED_ORIGIN = 'https://blocked.example';
  let registrationsAsked = 0;
  await page.route('**/api/sideload', async (route) => {
    registrationsAsked += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'acknowledged',
        registrations: [
          {
            url: `${BLOCKED_ORIGIN}/w/gridmason.widget.json`,
            origin: BLOCKED_ORIGIN,
            hash: 'sha256-Zm9vYmFyYmF6',
            acknowledgedBy: 'alice',
            at: '2026-07-14T00:00:00.000Z',
          },
        ],
        scriptSrc: [BLOCKED_ORIGIN],
      }),
    });
  });

  // Fail loudly if the off client ever tries to reach the remote's origin (its
  // descriptor or entry module) — an admitted remote would.
  const originHits: string[] = [];
  page.on('request', (req) => {
    if (req.url().startsWith(BLOCKED_ORIGIN)) originHits.push(req.url());
  });

  await page.goto('/');
  await expect(page.locator(CANVAS).locator('.grid-stack-item')).toHaveCount(4);
  // Enter edit mode too — nothing about editing may wake the acknowledged path.
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await expect(page.getByText('Editing layout')).toBeVisible();

  // The off client never consulted the registrations endpoint, so no acknowledged
  // remote resolved, none entered the import map, none was fetched, and none mounted.
  expect(registrationsAsked).toBe(0);
  expect(originHits).toEqual([]);
  await expect(page.locator('.gm-ack-badge')).toHaveCount(0);
});

test('the demo API reports the off posture by default and permits no acknowledged origin in script-src', async ({
  page,
}) => {
  // The server-side, config-recorded authority (server/config `sideload.mode`,
  // default off). Read straight from the real API (not the stub above): the posture
  // is off and the CSP `script-src` additions it authorizes are empty — the
  // production CSP is never relaxed by default, regardless of what is registered.
  // Reading the registrations needs a session, so sign in the stub owner first.
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'alice', password: 'alice-dev-password' },
  });
  expect(login.ok()).toBe(true);

  const res = await page.request.get('/api/sideload');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { mode: string; scriptSrc: string[] };
  expect(body.mode).toBe('off');
  expect(body.scriptSrc).toEqual([]);
});
