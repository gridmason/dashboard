import { describe, expect, it, vi } from 'vitest';
import {
  ensureServiceWorkerControl,
  type SwLifecycleOps,
} from './sw-lifecycle';

/** A fake SW container with sensible defaults, overridable per test. */
function ops(overrides: Partial<SwLifecycleOps> = {}): SwLifecycleOps {
  return {
    hasServiceWorker: true,
    isControlled: () => false,
    register: vi.fn(async () => {}),
    awaitActivation: vi.fn(async () => {}),
    waitForControl: vi.fn(async () => true),
    hasReloaded: () => false,
    markReloaded: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}

describe('ensureServiceWorkerControl (SPEC §2; FR-11 control-before-import-map)', () => {
  it('fails closed when the browser has no service worker (unavailable → shell-bundled only)', async () => {
    const o = ops({ hasServiceWorker: false, register: vi.fn(async () => {}) });
    expect(await ensureServiceWorkerControl(o)).toEqual({ status: 'unsupported' });
    // Never even attempts to register.
    expect(o.register).not.toHaveBeenCalled();
  });

  it('fails closed on a registration error', async () => {
    const o = ops({ register: vi.fn(async () => { throw new Error('SecurityError'); }) });
    expect(await ensureServiceWorkerControl(o)).toEqual({
      status: 'failed',
      reason: 'registration-error',
    });
  });

  it('is controlled immediately when a controller is already present (returning visit)', async () => {
    const waitForControl = vi.fn(async () => true);
    const o = ops({ isControlled: () => true, waitForControl });
    expect(await ensureServiceWorkerControl(o)).toEqual({ status: 'controlled' });
    // Registration + activation are ordered before the control check.
    expect(o.register).toHaveBeenCalledTimes(1);
    expect(o.awaitActivation).toHaveBeenCalledTimes(1);
    // No need to wait for a claim — already controlling.
    expect(waitForControl).not.toHaveBeenCalled();
  });

  it('becomes controlled after the first-visit claim (register → activate → await control)', async () => {
    const o = ops({ isControlled: () => false, waitForControl: vi.fn(async () => true) });
    expect(await ensureServiceWorkerControl(o)).toEqual({ status: 'controlled' });
    expect(o.waitForControl).toHaveBeenCalledTimes(1);
    // The claim path did not need a reload.
    expect(o.reload).not.toHaveBeenCalled();
  });

  it('reloads exactly once when control does not arrive, and does not loop', async () => {
    const o = ops({
      isControlled: () => false,
      waitForControl: vi.fn(async () => false),
      hasReloaded: () => false,
    });
    expect(await ensureServiceWorkerControl(o)).toEqual({ status: 'reloading' });
    expect(o.markReloaded).toHaveBeenCalledTimes(1);
    expect(o.reload).toHaveBeenCalledTimes(1);
  });

  it('fails closed (no-control) rather than reloading again after the one reload was spent', async () => {
    const o = ops({
      isControlled: () => false,
      waitForControl: vi.fn(async () => false),
      hasReloaded: () => true,
    });
    expect(await ensureServiceWorkerControl(o)).toEqual({ status: 'failed', reason: 'no-control' });
    expect(o.reload).not.toHaveBeenCalled();
  });
});
