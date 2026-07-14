import { describe, expect, it } from 'vitest';
import {
  acknowledgedSideloadEnabled,
  DEFAULT_SIDELOAD_MODE,
  resolveSideloadMode,
  SIDELOAD_NO_VERIFY_CAVEAT,
  type SideloadMode,
} from './policy';

/**
 * The client sideload posture (SPEC §4, FR-8/FR-16, issue #13). These lock the
 * one invariant #13 exists to enforce: `off` is the default, and only an explicit
 * `acknowledged` posture admits an acknowledged remote into the import map. Under
 * Vitest the `__GM_SIDELOAD_MODE__` define is absent, so `resolveSideloadMode()`
 * with no argument exercises the real unconfigured default the app boots with.
 */
describe('sideload policy', () => {
  it('defaults to off — the unconfigured build admits no sideloaded remote', () => {
    expect(DEFAULT_SIDELOAD_MODE).toBe('off');
    // No define under Vitest: the zero-argument path is the true boot default.
    expect(resolveSideloadMode()).toBe('off');
    expect(acknowledgedSideloadEnabled()).toBe(false);
  });

  it('resolves each known posture verbatim', () => {
    for (const mode of ['off', 'dev', 'acknowledged'] as SideloadMode[]) {
      expect(resolveSideloadMode(mode)).toBe(mode);
    }
  });

  it('treats any unknown, empty, or non-string posture as off (never more permissive)', () => {
    for (const raw of [undefined, '', 'ack', 'ON', 'Acknowledged', 1, null, {}]) {
      expect(resolveSideloadMode(raw)).toBe('off');
      expect(acknowledgedSideloadEnabled(resolveSideloadMode(raw))).toBe(false);
    }
  });

  it('enables acknowledged loading only for the acknowledged posture', () => {
    expect(acknowledgedSideloadEnabled('acknowledged')).toBe(true);
    expect(acknowledgedSideloadEnabled('off')).toBe(false);
    expect(acknowledgedSideloadEnabled('dev')).toBe(false);
  });

  it('exposes the Phase-A honesty caveat verbatim (FR-8)', () => {
    expect(SIDELOAD_NO_VERIFY_CAVEAT).toBe(
      'no verify chain yet — run only widgets you built or reviewed yourself',
    );
  });
});
