import { expect, test, type Page } from '@playwright/test';

/**
 * Service Worker buffer-verify-serve, end to end in the browser (SPEC §2; FR-11,
 * issue #19). Runs against the **production** preview build, whose root emits the
 * real `/federated-sw.js` (vite.config.ts). The showcase never registers the SW
 * (no registry configured), so this spec registers it directly and drives it with
 * a hand-crafted enforcement table — the same page → SW hand-off the federated boot
 * performs — then asserts the three verdicts on real bytes:
 *
 * - a URL whose bytes match its listed hash is **served** (buffer-verify-serve);
 * - a URL whose listed hash no longer matches the served bytes is **refused** as a
 *   network error (the tampered-chunk case → the importer's `import()` rejects);
 * - a URL on a guarded origin that no table entry claims is **refused** outright.
 *
 * The target artifact is the SW's own script — a real, stable, same-origin file — so
 * the test needs no separate CDN fixture. Trust is bound per URL, so claiming a URL
 * makes its origin "federated territory": an unclaimed sibling URL there is refused.
 * The SW's decision core is additionally unit-tested under Node
 * (src/boot/sw/*.test.ts); this proves the built worker registers, controls the
 * page, and enforces on real bytes.
 */

const TARGET_PATH = '/federated-sw.js';

/**
 * Register the SW and resolve once it controls the page (it claims clients on
 * activate) — the page-side lifecycle of register-federated-sw.ts, run in the browser.
 */
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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  // Unregister so no controlling SW / guarding table leaks (contexts are isolated,
  // but this keeps the worker from lingering across this spec's own steps).
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  });
});

test('the built SW registers and controls the page (control-before-import-map)', async ({ page }) => {
  expect(await registerAndAwaitControl(page)).toBe('controlled');
});

test('buffer-verify-serve: matching bytes are served, tampered bytes are refused, unclaimed URLs are refused', async ({
  page,
}) => {
  expect(await registerAndAwaitControl(page)).toBe('controlled');

  const result = await page.evaluate(async (targetPath) => {
    const origin = location.origin;
    const targetUrl = origin + targetPath;

    // Compute the real hash of the target artifact (table is empty → passthrough here).
    const original = await fetch(targetUrl, { cache: 'no-store' });
    const bytes = new Uint8Array(await original.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const goodHash = `sha2-256:${hex}`;
    const expectedText = new TextDecoder().decode(bytes);

    // Hand the SW a table over a MessageChannel and await its ack (as the boot does).
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

    // Fetch through the SW; report whether it served or refused (network error).
    const probe = async (url: string): Promise<{ served: boolean; status: number; text: string }> => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        return { served: true, status: response.status, text: await response.text() };
      } catch {
        return { served: false, status: 0, text: '' };
      }
    };

    // 1. Claimed + correct hash → served, exact bytes.
    const ackGood = await installTable([[targetUrl, goodHash]]);
    const match = await probe(targetUrl);

    // 2. Claimed + wrong hash (tampered) → refused (network error).
    const ackBad = await installTable([[targetUrl, `sha2-256:${'0'.repeat(64)}`]]);
    const mismatch = await probe(targetUrl);

    // 3. A sibling URL the table does not claim, on the (now guarded) origin → refused.
    const ackSibling = await installTable([[`${targetUrl}?claimed=1`, goodHash]]);
    const unclaimed = await probe(targetUrl);

    return { ackGood, ackBad, ackSibling, match, mismatch, unclaimed, expectedText };
  }, TARGET_PATH);

  // Every hand-off was acknowledged (the SW installed each table before we probed).
  expect(result.ackGood).toBe(true);
  expect(result.ackBad).toBe(true);
  expect(result.ackSibling).toBe(true);

  // Matching bytes served unchanged.
  expect(result.match.served).toBe(true);
  expect(result.match.status).toBe(200);
  expect(result.match.text).toBe(result.expectedText);

  // Tampered (hash-mismatch) → refused as a network error.
  expect(result.mismatch.served).toBe(false);

  // Unclaimed URL on a guarded origin → refused outright.
  expect(result.unclaimed.served).toBe(false);
});
