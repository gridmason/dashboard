import { expect, test, type Page } from '@playwright/test';
import { INSTANCE_TOKEN_HEADER } from '../server/sdk-identity/index';

/**
 * **Phase B (D-E4) exit demo, scripted** (docs/exit-demo.md; SPEC §2, §3, §7). One
 * end-to-end flow that drives the four things the D-E4 exit demo must show:
 *
 * 1. **A governed, locked page renders** through the one generic canvas — a fully
 *    locked page type (`demo.locked`, `allow_user_customization: false`) boots and
 *    places its widgets, with no per-page special-casing (FR-1, FR-4; SPEC §5).
 * 2. **The verified federated-widget path** — the Service Worker's
 *    buffer-verify-serve gate serves an artifact whose bytes match its pinned hash
 *    and **refuses a tampered one** (FR-11; SPEC §2). This is the fetch a federated
 *    widget's module rides in from a registry CDN; the artifact here stands in for
 *    a flagship / self-hosted registry release.
 * 3. **Token enforcement** — a capability-gated API call is **denied without a
 *    per-instance token** (an SDK bypass) and **allowed with one** (FR-9/FR-14;
 *    SPEC §3 rules 1-3).
 * 4. **The revocation kill switch** — revoking the instance token makes the same
 *    previously-allowed call **deny immediately** (FR-12; SPEC §3 rule 6), and, at
 *    the fetch layer, an artifact whose claim was withdrawn is refused (2).
 *
 * What this scripts against **mocks** vs. what needs the **live registry fixture**
 * is spelled out in docs/exit-demo.md: the registry *resolution + release
 * verification + revocation feed* end to end (registry R-E1–R-E3, cli L-E3/L-E4)
 * is not yet available, so the verified-fetch and kill-switch mechanics are driven
 * directly here (the exact hand-offs the federated boot performs), not through a
 * running registry.
 */

const CANVAS = 'gm-page-canvas[aria-label="Page canvas — grid of widgets"]';
const SW_PATH = '/federated-sw.js';

/** Register the federated SW and resolve once it controls the page (as the boot does). */
async function registerAndAwaitControl(page: Page): Promise<'controlled' | 'unsupported' | 'timeout'> {
  return page.evaluate(async () => {
    const nav = navigator.serviceWorker;
    if (nav === undefined) return 'unsupported' as const;
    await nav.register('/federated-sw.js', { type: 'module' });
    await nav.ready;
    if (nav.controller !== null) return 'controlled' as const;
    return await new Promise<'controlled' | 'timeout'>((resolve) => {
      const onChange = () => {
        if (nav.controller !== null) {
          nav.removeEventListener('controllerchange', onChange);
          resolve('controlled');
        }
      };
      nav.addEventListener('controllerchange', onChange);
      setTimeout(() => resolve(nav.controller !== null ? 'controlled' : 'timeout'), 5000);
    });
  });
}

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    if (regs !== undefined) await Promise.all(regs.map((r) => r.unregister()));
  });
});

test.describe('Phase B exit demo (D-E4)', () => {
  test('step 1 — a governed, locked page renders through the one canvas', async ({ page }) => {
    await page.goto('/p/demo.locked');
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute('data-page-type', 'demo.locked');
    // The fully-locked page places its widgets — governed content renders, and the
    // healthy first-party widgets are up (no page-type-specific code path).
    await expect(canvas.locator('.grid-stack-item')).toHaveCount(3);
    await expect(canvas.locator('.gm-markdown').first()).toBeVisible();
    await expect(canvas.locator('.gm-chart').first()).toBeVisible();
  });

  test('step 2 & 4b — verified federated fetch serves good bytes and refuses tampered / withdrawn', async ({
    page,
  }) => {
    await page.goto('/');
    expect(await registerAndAwaitControl(page)).toBe('controlled');

    const result = await page.evaluate(async (swPath) => {
      const targetUrl = location.origin + swPath;
      // Compute the artifact's real hash (the registry release document would pin this).
      const bytes = new Uint8Array(await (await fetch(targetUrl, { cache: 'no-store' })).arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const goodHash = `sha2-256:${hex}`;

      const installTable = (entries: Array<[string, string]>) =>
        new Promise<boolean>((resolve) => {
          const controller = navigator.serviceWorker.controller;
          if (controller === null) return resolve(false);
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) =>
            resolve((event.data as { type?: string } | null)?.type === 'gm-sw/enforcement-ack');
          controller.postMessage({ type: 'gm-sw/enforcement-table', entries }, [channel.port2]);
          setTimeout(() => resolve(false), 3000);
        });
      const served = async (url: string) => {
        try {
          return (await fetch(url, { cache: 'no-store' })).ok;
        } catch {
          return false;
        }
      };

      // Verified release: bytes match the pinned hash → served.
      await installTable([[targetUrl, goodHash]]);
      const verified = await served(targetUrl);
      // Tampered release: hash no longer matches → refused.
      await installTable([[targetUrl, `sha2-256:${'0'.repeat(64)}`]]);
      const tampered = await served(targetUrl);
      // Kill switch (fetch layer): the claim is withdrawn (a sibling is claimed
      // instead, so the origin is guarded but this URL is no longer covered) → refused.
      await installTable([[`${targetUrl}?claimed=1`, goodHash]]);
      const withdrawn = await served(targetUrl);
      return { verified, tampered, withdrawn };
    }, SW_PATH);

    expect(result.verified).toBe(true);
    expect(result.tampered).toBe(false);
    expect(result.withdrawn).toBe(false);
  });

  test('step 3 & 4a — token enforcement and the revocation kill switch', async ({ request }) => {
    // The acting user's session (the single-tenant deployment owner).
    const login = await request.post('/api/auth/login', {
      data: { username: 'alice', password: 'alice-dev-password' },
    });
    expect(login.ok()).toBeTruthy();

    // An SDK bypass: a capability-gated read with session auth but *no* instance
    // token is denied — the widget reached the API as an anonymous page script.
    const bypass = await request.get('/api/records/customer/cust-1');
    expect(bypass.status()).toBe(403);

    // The shell mints and registers a per-instance token binding (instanceId,
    // widgetId, declared capabilities) — the rail the SDK transport stamps.
    const token = `itk_${Math.random().toString(16).slice(2)}`;
    const register = await request.post('/api/sdk/instance', {
      data: {
        token,
        instanceId: `inst-${Math.random().toString(16).slice(2)}`,
        widgetId: { source: 'local', tag: 'gm-record-summary-widget' },
        capabilities: ['records.read:recordType:customer'],
      },
    });
    expect(register.status()).toBe(201);

    // With the instance token stamped and the capability granted → allowed.
    const allowed = await request.get('/api/records/customer/cust-1', {
      headers: { [INSTANCE_TOKEN_HEADER]: token },
    });
    expect(allowed.status()).toBe(200);

    // Kill switch: revoke the instance token; the same call now denies immediately
    // (SPEC §3 rule 6) — a killed instance never reaches data again.
    const revoke = await request.delete('/api/sdk/instance', {
      headers: { [INSTANCE_TOKEN_HEADER]: token },
    });
    expect(revoke.status()).toBe(204);

    const afterKill = await request.get('/api/records/customer/cust-1', {
      headers: { [INSTANCE_TOKEN_HEADER]: token },
    });
    expect(afterKill.status()).toBe(403);
  });
});
