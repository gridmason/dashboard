/**
 * Page-context **values** (docs/SPEC.md §3, §5).
 *
 * A page type declares the *type* of context it provides (its `ContextMap`, in
 * `page-types.ts`); this module builds the concrete *value* the shell hands to
 * `PageCanvas.context`, which serializes it to every widget's `context`
 * attribute. Only `record-ref` slots carry data in the demos: a typed
 * `record-ref` context binds to the route's `entityId` (e.g.
 * `/p/demo.record-detail/cust-42` → `{ record: { recordType, id: 'cust-42' } }`).
 *
 * A page type with no declared context (a free `dashboards.home`, the locked
 * demos) provides no value — `undefined`, which the canvas serializes to a
 * null context so widgets can tell "no context" from "empty context".
 */

import type { RecordRefContextType } from '@gridmason/protocol';
import type { DemoPageType } from './page-types';

/** The runtime value of a `record-ref` context slot: its record type and the bound id. */
export interface RecordRefValue {
  /** The host-declared record kind the slot is typed as (e.g. `customer`). */
  readonly recordType: string;
  /** The bound record id from the route, or `null` when the page is not entity-scoped. */
  readonly id: string | null;
}

/** A `record-ref` type guard over a declared context type. */
function isRecordRef(type: { readonly type: string }): type is RecordRefContextType {
  return type.type === 'record-ref';
}

/**
 * Build the context value a page provides to its widgets, from the page type's
 * declared context and the route's optional `entityId`. Returns `undefined` when
 * the page declares no context. Each declared `record-ref` slot becomes a
 * {@link RecordRefValue} bound to `entityId`; other declared slots are omitted
 * (the demos only exercise `record-ref`).
 */
export function buildPageContext(
  pageType: DemoPageType,
  entityId?: string,
): Readonly<Record<string, RecordRefValue>> | undefined {
  const entries = Object.entries(pageType.descriptor.context);
  const context: Record<string, RecordRefValue> = {};
  for (const [slot, type] of entries) {
    if (isRecordRef(type)) {
      context[slot] = { recordType: type.recordType, id: entityId ?? null };
    }
  }
  return Object.keys(context).length > 0 ? context : undefined;
}
