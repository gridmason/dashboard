/**
 * Page-side **SW establishment + table hand-off** (docs/SPEC.md §2; FR-11) — the thin
 * DOM wrapper that drives the pure lifecycle gate (./sw-lifecycle) with real
 * `navigator.serviceWorker` primitives, then hands the enforcement table to the
 * controlling worker and waits for its acknowledgement.
 *
 * The contract the federated boot needs: {@link establishFederatedSwControl} resolves
 * to `true` **only** when the verifying SW controls the page *and* has acknowledged
 * the enforcement table — the two preconditions for letting a federated remote's
 * `import()` fire (nothing federated may load before the SW is in front of it *and*
 * knows what to enforce). Any other outcome (unsupported, registration error, control
 * never arrived, reloading) resolves `false`: fail closed.
 *
 * Not unit-tested (Vitest has no `navigator.serviceWorker`); the ordering it encodes
 * is proven in ./sw-lifecycle.test.ts against a fake container, and the whole path is
 * exercised in the browser. Kept deliberately mechanical so that test split holds.
 */
import {
  ensureServiceWorkerControl,
  type SwControlOutcome,
  type SwLifecycleOps,
} from './sw-lifecycle';
import {
  ENFORCEMENT_ACK_TYPE,
  enforcementTableFrom,
} from './enforcement-table';
import { SESSION_TOKEN_MESSAGE_TYPE, type SessionTokenMessage } from './session-token';
import type { MultihashString } from '@gridmason/protocol/verify';

/** The built SW is emitted to the app root so it can claim scope `/` (vite.config.ts). */
const SW_URL = '/federated-sw.js';
/** `sessionStorage` flag guarding the single permitted reload (per tab, cleared on close). */
const RELOAD_FLAG = 'gm-sw/reloaded';
/** How long to wait for control to arrive after activation before reloading. */
const CONTROL_TIMEOUT_MS = 3_000;
/** How long to wait for the SW to acknowledge the enforcement table before failing closed. */
const ACK_TIMEOUT_MS = 3_000;

/** Whether this browser exposes the Service Worker API at all. */
function hasServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** Build the real lifecycle primitives over `navigator.serviceWorker`. */
function domOps(): SwLifecycleOps {
  const container = navigator.serviceWorker;
  return {
    hasServiceWorker: true,
    isControlled: () => container.controller !== null,
    register: async () => {
      await container.register(SW_URL, { type: 'module' });
    },
    awaitActivation: async () => {
      await container.ready;
    },
    waitForControl: () =>
      new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean): void => {
          if (settled) return;
          settled = true;
          container.removeEventListener('controllerchange', onChange);
          resolve(value);
        };
        const onChange = (): void => finish(container.controller !== null);
        container.addEventListener('controllerchange', onChange);
        setTimeout(() => finish(container.controller !== null), CONTROL_TIMEOUT_MS);
      }),
    hasReloaded: () => {
      try {
        return sessionStorage.getItem(RELOAD_FLAG) === '1';
      } catch {
        // Storage disabled → treat as already-reloaded so we never loop; fail closed.
        return true;
      }
    },
    markReloaded: () => {
      try {
        sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        // Best effort — if we cannot persist the flag, `hasReloaded` returns `true`
        // above, so the reload branch is not taken and we fail closed instead of loop.
      }
    },
    reload: () => {
      location.reload();
    },
  };
}

/**
 * Hand the enforcement table to the controlling SW and await its acknowledgement over
 * a private {@link MessageChannel}. Resolves `true` on ack, `false` on timeout / no
 * controller — the caller fails closed on `false` (never mount without an enforced
 * table).
 */
async function handOffTable(urlHashes: ReadonlyMap<string, MultihashString>): Promise<boolean> {
  const controller = navigator.serviceWorker.controller;
  if (controller === null) return false;

  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      channel.port1.onmessage = null;
      resolve(value);
    };
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown } | null;
      finish(data?.type === ENFORCEMENT_ACK_TYPE);
    };
    controller.postMessage(enforcementTableFrom(urlHashes).toMessage(), [channel.port2]);
    setTimeout(() => finish(false), ACK_TIMEOUT_MS);
  });
}

/**
 * Hand the shell's session token to the controlling SW (FR-14), or clear it with
 * `null`. Fire-and-forget over `postMessage` — the SW holds it in memory and
 * attaches it to outbound API calls (`../../sw/federated-sw`); the token leaves the
 * page here and is never stored in page-accessible JS. A no-op when no SW controls
 * the page yet (the credential is re-handed once control lands). The caller passes a
 * token obtained under the session it already established; this function keeps no
 * reference to it beyond the post.
 */
export function handOffSessionToken(token: string | null): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const controller = navigator.serviceWorker.controller;
  if (controller === null) return;
  const message: SessionTokenMessage = { type: SESSION_TOKEN_MESSAGE_TYPE, token };
  controller.postMessage(message);
}

/**
 * Bring the page under the verifying SW's control and install the enforcement table.
 * Resolves `true` only when the SW controls the page and has acknowledged the table;
 * `false` on any fail-closed outcome. `ensure` is injectable for a future harness; it
 * defaults to the real lifecycle over `navigator.serviceWorker`.
 */
export async function establishFederatedSwControl(
  urlHashes: ReadonlyMap<string, MultihashString>,
  ensure: (ops: SwLifecycleOps) => Promise<SwControlOutcome> = ensureServiceWorkerControl,
): Promise<boolean> {
  if (!hasServiceWorker()) return false;

  const outcome = await ensure(domOps());
  if (outcome.status !== 'controlled') return false;

  return handOffTable(urlHashes);
}
