/**
 * Pure `record-ref` context reading for the record-summary demo widget
 * (docs/SPEC.md §3, §5) — DOM-free, unit-testable under Node.
 *
 * The page provides a typed `record-ref` context value (built in
 * `../../pages/context.ts`): `{ <slot>: { recordType, id } }`, serialized onto
 * every widget's `context` attribute by the canvas. This module extracts the
 * first `record-ref`-shaped slot from that value, tolerating the "no context"
 * cases (absent page context, entity-less route → `id: null`).
 */

/** A record reference pulled from page context: the record kind and bound id. */
export interface RecordRef {
  /** The host-declared record kind the slot is typed as (e.g. `customer`). */
  readonly recordType: string;
  /** The bound record id from the route, or `null` when the page is not entity-scoped. */
  readonly id: string | null;
}

/** Whether `value` has the `{ recordType: string, id: string|null }` shape. */
function isRecordRef(value: unknown): value is RecordRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.recordType === 'string' &&
    (typeof candidate.id === 'string' || candidate.id === null)
  );
}

/**
 * Extract the first `record-ref` value from a page-context object, or
 * `undefined` when the context carries none (no context provided, or a context
 * with no record-shaped slot). The demos provide a single `record` slot; taking
 * the first record-shaped entry keeps the widget agnostic to the slot name.
 */
export function readRecordRef(context: unknown): RecordRef | undefined {
  if (typeof context !== 'object' || context === null) return undefined;
  for (const value of Object.values(context as Record<string, unknown>)) {
    if (isRecordRef(value)) return value;
  }
  return undefined;
}
