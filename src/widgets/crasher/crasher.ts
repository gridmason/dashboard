/**
 * `gm-crasher-widget` — the deliberate error-boundary demo (docs/SPEC.md §3, §7).
 *
 * It **throws in `connectedCallback`**, on mount. Core's per-widget boundary
 * guards the synchronous mount window (a global `error` listener plus a
 * try/catch — see core's `WidgetBoundary#attemptMount`), so this throw is caught
 * and attributed to *this* widget: its cell is replaced by the fallback card
 * (widget name + Retry) while every sibling widget and the rest of the page keep
 * rendering. The shell never blocks on widget code. Retry re-runs the lifecycle —
 * and, being deliberate, this widget throws again, which is the point of the demo.
 *
 * The thrown message can be customized via `settings.message`; it flows into the
 * boundary's `widget.error` telemetry. Same-document custom element.
 */

import { WIDGET_TAGS } from '../../boot/import-map';
import { readSettings, readStringProp } from '../abi';

/** The custom-element tag, sourced from the import map (`../../boot/import-map`). */
export const CRASHER_WIDGET_TAG = WIDGET_TAGS.crasher;

/** The message thrown when `settings` supplies none. */
export const DEFAULT_CRASH_MESSAGE = 'Deliberate demo crash on mount';

class CrasherWidget extends HTMLElement {
  connectedCallback(): void {
    const message = readStringProp(readSettings(this), 'message', DEFAULT_CRASH_MESSAGE);
    throw new Error(message);
  }
}

/** Register `<gm-crasher-widget>` once; guarded for idempotent import-map loads. */
export function defineCrasherWidget(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(CRASHER_WIDGET_TAG) !== undefined) return;
  customElements.define(CRASHER_WIDGET_TAG, CrasherWidget);
}

defineCrasherWidget();
