/**
 * Sideload telemetry (docs/SPEC.md §4 + §6) — the **prod-safe** emit seam for the
 * one security-relevant sideload event Phase A raises: an acknowledged remote
 * whose fetched content does not match its pinned hash (FR-8: "hash mismatch on
 * load → refused + telemetry").
 *
 * SPEC §6 names the reference telemetry adapter a "console/OTLP exporter"; the full
 * adapter is Phase B. This is the minimal Phase-A stand-in: a typed event and a
 * sink. The default sink writes a `console.warn` so a refused load is visible in a
 * deployed dashboard's console; the sink is injectable so the load path's tests can
 * assert the event was emitted without spying on the console.
 */

/** The sideload telemetry events Phase A emits. */
export type SideloadTelemetryEvent = {
  readonly type: 'sideload.hash_mismatch';
  /** The registered remote URL whose entry failed verification. */
  readonly url: string;
  /** The pinned hash the content was expected to match. */
  readonly expected: string;
  /** The hash the fetched content actually produced (`unknown` if it could not be hashed). */
  readonly actual: string;
};

/** A telemetry sink — receives every {@link SideloadTelemetryEvent}. */
export type SideloadTelemetry = (event: SideloadTelemetryEvent) => void;

/** Stable prefix on the default sink's console output, so it is greppable in logs/e2e. */
export const SIDELOAD_TELEMETRY_PREFIX = '[gridmason:sideload]';

/**
 * The default sink: a console exporter (SPEC §6). A hash mismatch is a refused
 * load, so it warns with the URL and the expected/actual pins — enough for an
 * operator to see that a pinned remote's content drifted (or was tampered) and
 * was not mounted.
 */
export const consoleSideloadTelemetry: SideloadTelemetry = (event) => {
  if (event.type === 'sideload.hash_mismatch') {
    // eslint-disable-next-line no-console
    console.warn(
      `${SIDELOAD_TELEMETRY_PREFIX} refused ${event.url}: content hash ${event.actual} does not match pin ${event.expected}`,
    );
  }
};
