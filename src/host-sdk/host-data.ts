/**
 * Phase-A demo host data for the interim SDK handle (docs/SPEC.md §5, §6, FR-9).
 *
 * The interim handle (`./interim-handle`) is fixture-backed, but the fixtures
 * have to come from somewhere: in Phase A there is no registry, no host API, and
 * no real record store (those are D-E3/D-E4). This module is the stand-in
 * "host": it turns a page's typed `record-ref` context into the fixture records
 * a context-consumer widget reads back, so `demo.record-detail` renders real
 * data through `sdk.records.read` instead of empty defaults.
 *
 * It also bridges the dashboard's own page-context value ({@link DashboardContext},
 * whose `record-ref` id may be `null` on a non-entity-scoped page — see
 * `../pages/context`) into the SDK's protocol {@link PageContext} value type
 * (whose `record-ref` id is a plain `string`). Only fully-bound record refs
 * (non-null id) become handle context — a page opened without an entity has no
 * record to read, so it gets a no-op handle.
 *
 * Everything here is demo scaffolding. The Phase-B handle (D-E4) reads the same
 * `records.read` shape from the real host API; swapping this out for that never
 * touches the widget, which only ever sees `sdk.records.read` (SPEC §6).
 */

import type { FixtureFile } from '@gridmason/sdk/fixture';
import type { Capability, PageContext, RecordRefValue } from '@gridmason/sdk';
import type { RecordRefValue as DashboardRecordRefValue } from '../pages/context';
import type { HostData } from './interim-handle';

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

/** The demo record a Phase-A page reads for one bound `record-ref` — generic, host-agnostic fields. */
function demoRecordFields(ref: RecordRefValue): Readonly<Record<string, unknown>> {
  return {
    name: `Demo ${ref.recordType} ${ref.id}`,
    recordType: ref.recordType,
    id: ref.id,
    summary: `Fixture-backed ${ref.recordType} record served by the Phase-A interim host (FR-9).`,
  };
}

/**
 * Assemble the Phase-A {@link HostData} a page's handle serves, from its already
 * protocol-shaped {@link PageContext}: one fixture read record per bound
 * `record-ref` slot, plus the `records.read` capability that record's type needs
 * so the fixture's own capability check does not deny the read. Returns
 * `undefined` when the context binds no record ref (nothing to read → the handle
 * is no-op-backed).
 */
export function demoHostData(context: PageContext | undefined): HostData | undefined {
  if (context === undefined) return undefined;
  const read: Array<{ ref: RecordRefValue; fields: Readonly<Record<string, unknown>> }> = [];
  const capabilityScopes = new Set<string>();
  for (const value of Object.values(context)) {
    if (isRecordRefValue(value)) {
      read.push({ ref: { recordType: value.recordType, id: value.id }, fields: demoRecordFields(value) });
      capabilityScopes.add(value.recordType);
    }
  }
  if (read.length === 0) return undefined;
  const fixtures: FixtureFile = { records: { read } };
  const capabilities: Capability[] = [...capabilityScopes].map((recordType) => ({
    api: 'records.read',
    scope: `recordType:${recordType}`,
  }));
  return { fixtures, capabilities };
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
