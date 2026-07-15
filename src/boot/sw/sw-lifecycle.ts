/**
 * **Control-before-import-map** — the SW lifecycle gate that makes the Service Worker
 * part of the trust chain (docs/SPEC.md §2; FR-11). Split out of the page-side DOM
 * wrapper (../boot/sw/register-federated-sw) so the *ordering* is unit-tested under
 * Node with a fake container, since Vitest has no `navigator.serviceWorker`.
 *
 * SPEC §2: the shell assembles the import map — i.e. lets a federated remote become
 * mountable — **only after the Service Worker controls the page**. First visit:
 * register → await activation → await control (the SW claims existing clients on
 * activate), reloading **once** if control still has not arrived → then resolve
 * remotes. If the SW is unavailable (unsupported, disabled storage, registration
 * error) the shell **fails closed**: no federated remote loads without the verifying
 * SW in front of it.
 *
 * This module encodes exactly that decision as a pure async state machine over
 * injected primitives ({@link SwLifecycleOps}); the caller maps the {@link
 * SwControlOutcome} to "install federated remotes" vs "fail closed". The one-reload
 * guard lives in the ops (a `sessionStorage` flag) so a browser that never yields
 * control cannot loop.
 */

/**
 * The result of trying to bring the page under SW control:
 * - `controlled` — the SW controls the page; federated remotes may be installed;
 * - `reloading` — control had not arrived, so the page was reloaded once; the current
 *   execution is abandoned and nothing federated is installed *this* load (the reload
 *   re-runs the flow, which then sees a controller from the start);
 * - `unsupported` — no `serviceWorker` API at all; fail closed;
 * - `failed` — registration threw, or control never arrived even after the one reload;
 *   fail closed.
 */
export type SwControlOutcome =
  | { readonly status: 'controlled' }
  | { readonly status: 'reloading' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'failed'; readonly reason: 'registration-error' | 'no-control' };

/** The injected browser primitives {@link ensureServiceWorkerControl} drives (real ones in the DOM wrapper). */
export interface SwLifecycleOps {
  /** Whether `navigator.serviceWorker` exists at all (unsupported browsers / disabled storage → fail closed). */
  readonly hasServiceWorker: boolean;
  /** Whether a SW currently controls the page (`navigator.serviceWorker.controller != null`). */
  isControlled(): boolean;
  /** Register the shell's SW. Rejects on a registration error → the flow fails closed. */
  register(): Promise<void>;
  /** Resolve once the registered SW has activated (`navigator.serviceWorker.ready`). */
  awaitActivation(): Promise<void>;
  /**
   * Wait (bounded) for control to arrive after activation — the SW claims existing
   * clients on activate, firing `controllerchange`. Resolves `true` if a controller
   * is present within the window, `false` if it timed out.
   */
  waitForControl(): Promise<boolean>;
  /** Whether this load already performed the one permitted reload (a persisted flag). */
  hasReloaded(): boolean;
  /** Record that the one permitted reload is being performed (persist before reloading). */
  markReloaded(): void;
  /** Reload the page once, to pick up a controller present from the start of the next load. */
  reload(): void;
}

/**
 * Drive the page to SW control, or a fail-closed outcome. Register → await activation
 * → if not yet controlled, wait (bounded) for the claim; if still not controlled,
 * reload **once** (guarded), else give up. Never throws — a registration rejection
 * becomes `failed`, not an exception.
 */
export async function ensureServiceWorkerControl(
  ops: SwLifecycleOps,
): Promise<SwControlOutcome> {
  if (!ops.hasServiceWorker) return { status: 'unsupported' };

  try {
    await ops.register();
  } catch {
    return { status: 'failed', reason: 'registration-error' };
  }

  await ops.awaitActivation();

  // Already controlling (a returning visit whose SW controlled from first byte).
  if (ops.isControlled()) return { status: 'controlled' };

  // First visit: the SW claims clients on activate — wait (bounded) for that.
  if (await ops.waitForControl()) return { status: 'controlled' };

  // Control never arrived. Reload once (a controller is present from the start of the
  // next load); if we already spent that one reload, fail closed rather than loop.
  if (!ops.hasReloaded()) {
    ops.markReloaded();
    ops.reload();
    return { status: 'reloading' };
  }
  return { status: 'failed', reason: 'no-control' };
}
