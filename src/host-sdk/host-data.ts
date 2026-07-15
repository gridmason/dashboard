/**
 * Demo page-context bridging + declared-capability derivation for the reference
 * SDK handle (docs/SPEC.md §5, §6, FR-9).
 *
 * Two host concerns for the showcase:
 *
 * - **Context bridging.** The dashboard's own page-context value
 *   ({@link DashboardContext}, whose `record-ref` id may be `null` on a
 *   non-entity-scoped page — see `../pages/context`) is bridged into the SDK's
 *   protocol {@link PageContext} value type (whose `record-ref` id is a plain
 *   `string`). Only fully-bound record refs (non-null id) become handle context —
 *   a page opened without an entity has no record to read.
 * - **Declared capabilities.** A record-scoped page's context implies the
 *   `records.read:<scope>` capabilities its context-consumer widgets need; those
 *   are the *widget-declared* side of the reference handle's `min(user, widget)`
 *   gate ({@link demoDeclaredCapabilities}) so a bound record read is granted.
 *
 * Everything here is demo scaffolding. A product shell derives declared
 * capabilities from each widget's signed manifest instead; the widget only ever
 * sees `sdk.records.read` either way (SPEC §6).
 */

import type { Capability, PageContext, RecordRefValue } from '@gridmason/sdk';
import type { RecordRefValue as DashboardRecordRefValue } from '../pages/context';

/** The dashboard's page-context value (`../pages/context`): record-ref slots keyed by name. */
export type DashboardContext = Readonly<Record<string, DashboardRecordRefValue>> | undefined;

/** A protocol `record-ref` value has a non-null string id; the dashboard's may be null. */
function isBoundRecordRef(value: DashboardRecordRefValue): value is RecordRefValue {
  return value.id !== null;
}

/**
 * Convert the dashboard's page context into the SDK's protocol {@link PageContext}
 * value, keeping only fully-bound `record-ref` slots (non-null id). Returns
 * `undefined` when nothing is bound, so a no-context (or unbound) page yields no
 * handle context.
 */
export function toPageContext(context: DashboardContext): PageContext | undefined {
  if (context === undefined) return undefined;
  const bound: Record<string, RecordRefValue> = {};
  for (const [slot, value] of Object.entries(context)) {
    if (isBoundRecordRef(value)) {
      bound[slot] = { recordType: value.recordType, id: value.id };
    }
  }
  return Object.keys(bound).length > 0 ? bound : undefined;
}

/**
 * The `records.read:<scope>` capabilities a page's context implies — the
 * *widget-declared* side of the reference handle's `min(user, widget)` gate, one
 * per bound `record-ref` record type. Returns `[]` when the context binds no
 * record ref (nothing to read). A record-scoped page's handle declares these so
 * the bound record read is granted; the reference host still enforces the gate,
 * so a read outside them is denied with a typed `PermissionDenied` (SPEC §3).
 */
export function demoDeclaredCapabilities(context: PageContext | undefined): Capability[] {
  if (context === undefined) return [];
  const recordTypes = new Set<string>();
  for (const value of Object.values(context)) {
    if (isRecordRefValue(value)) recordTypes.add(value.recordType);
  }
  return [...recordTypes].map((recordType) => ({
    api: 'records.read',
    scope: `recordType:${recordType}`,
  }));
}

/** A `record-ref` context value (`{ recordType, id }`) — the only slot kind the demos read. */
function isRecordRefValue(value: unknown): value is RecordRefValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecordRefValue).recordType === 'string' &&
    typeof (value as RecordRefValue).id === 'string'
  );
}
