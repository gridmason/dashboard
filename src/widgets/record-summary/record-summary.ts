/**
 * `gm-record-summary-widget` — the **context-consumer** demo widget
 * (docs/SPEC.md §3, §5).
 *
 * It reads the page's typed `record-ref` context (delivered by `PageCanvas` on
 * the `context` attribute) and summarizes the bound record — the record kind and
 * its id — reacting in place when the context changes (no re-mount). On a page
 * with no record context, or an entity-less route, it shows an explicit empty
 * state rather than faulting.
 *
 * ## SDK read-path seam (#7)
 *
 * Phase A has no record store, so this widget renders straight from the context
 * *reference* (`{ recordType, id }`). Resolving that id to a full record — name,
 * fields, status — is the host **SDK read path**, finalized in the interim-SDK-
 * handle sibling issue (#7). Its contract (per #7): core 0.3.0 assigns the
 * per-instance handle onto the element **after** mount (via the canvas
 * `gm:rendered` / `gm:widget-mounted` events), so `element.sdk` is **not** present
 * during `connectedCallback`. When the seam below is implemented it must therefore
 * read `this.sdk` **lazily, at data-read time** (an async fetch kicked off from a
 * post-mount hook or a `gm:rendered` listener) — never synchronously in
 * `connectedCallback`, which would see `undefined`. Until then the widget consumes
 * the context as-delivered. Nothing here touches `host-sdk/`.
 */

import { WIDGET_TAGS } from '../../boot/import-map';
import { readContext } from '../abi';
import { readRecordRef, type RecordRef } from './record';
import './record-summary.css';

/** The custom-element tag, sourced from the import map (`../../boot/import-map`). */
export const RECORD_SUMMARY_WIDGET_TAG = WIDGET_TAGS.recordSummary;

/** Attributes that, when changed by the canvas, should re-render. */
const OBSERVED = ['context'] as const;

class RecordSummaryWidget extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  connectedCallback(): void {
    this.#render();
  }

  attributeChangedCallback(): void {
    // Context updates in place (SPEC §3) — re-render on every `context` change.
    if (this.isConnected) this.#render();
  }

  #render(): void {
    const ref = readRecordRef(readContext(this));
    this.replaceChildren();
    const card = this.ownerDocument.createElement('div');
    card.className = 'gm-record-summary';

    if (ref === undefined) {
      card.append(this.#emptyState('No record in context'));
    } else {
      // SEAM (#7): once the SDK handle is available, a post-mount hook (the handle
      // lands after connectedCallback, via gm:rendered) reads `this.sdk` lazily —
      // `this.sdk.getRecord(ref)` → render the resolved record's fields. Until
      // then, summarize the reference the page context provides.
      card.append(...this.#referenceView(ref));
    }
    this.append(card);
  }

  /** The reference summary: record kind + bound id (or an "unbound" note). */
  #referenceView(ref: RecordRef): readonly HTMLElement[] {
    const kind = this.ownerDocument.createElement('span');
    kind.className = 'gm-record-summary__kind';
    kind.textContent = ref.recordType;

    const id = this.ownerDocument.createElement('strong');
    id.className = 'gm-record-summary__id';
    id.textContent = ref.id ?? 'Unbound record';

    const note = this.ownerDocument.createElement('span');
    note.className = 'gm-record-summary__note';
    note.textContent =
      ref.id !== null
        ? 'Summary rendered from page context.'
        : 'This page is not scoped to a record.';

    return [kind, id, note];
  }

  #emptyState(message: string): HTMLElement {
    const empty = this.ownerDocument.createElement('span');
    empty.className = 'gm-record-summary__empty';
    empty.textContent = message;
    return empty;
  }
}

/** Register `<gm-record-summary-widget>` once; guarded for idempotent loads. */
export function defineRecordSummaryWidget(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(RECORD_SUMMARY_WIDGET_TAG) !== undefined) return;
  customElements.define(RECORD_SUMMARY_WIDGET_TAG, RecordSummaryWidget);
}

defineRecordSummaryWidget();
