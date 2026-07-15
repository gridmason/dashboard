/**
 * `gm-laggard-widget` — the deliberate **auto-degrade** demo (docs/SPEC.md §3, §7,
 * FR-15). The latency counterpart to the crasher: where the crasher throws on
 * mount (an *error* degrade), the laggard declares itself pending and then never
 * becomes interactive — so it blows its **latency budget** and core's boundary
 * auto-degrades it to its fallback card while the rest of the page renders.
 *
 * The readiness contract (core `WidgetBoundary`): dispatching `gm:loading` (here,
 * the boolean `gm-loading` attribute set in `connectedCallback`) shows a skeleton
 * and **starts the latency budget** the canvas configured (`latencyBudgetMs` +
 * `autoDegradeOnLatency`, wired in `CanvasHost` from
 * `WIDGET_LATENCY_BUDGET_MS`). Because the widget never dispatches `gm:ready`, the
 * budget elapses, the boundary emits a `widget.latency` `exceeded` event
 * (attributed to this instance), and swaps in the fallback — the exact FR-15 path.
 *
 * A `settings.delayMs` can shorten the demo's pending window for a test that wants
 * a fast, deterministic degrade without waiting the full production budget: the
 * widget still never readies, but a test can set a small `latencyBudgetMs` on the
 * canvas and observe the degrade quickly. Same-document custom element, no SDK.
 */

import { WIDGET_TAGS } from '../../boot/import-map';

/** The custom-element tag, sourced from the import map (`../../boot/import-map`). */
export const LAGGARD_WIDGET_TAG = WIDGET_TAGS.laggard;

class LaggardWidget extends HTMLElement {
  connectedCallback(): void {
    // Declare pending: the boolean `gm-loading` attribute (equivalently a
    // `gm:loading` event) tells the boundary to show a skeleton and arm the
    // latency budget. We intentionally never dispatch `gm:ready`, so the budget
    // elapses and the boundary auto-degrades this instance to its fallback.
    this.setAttribute('gm-loading', '');
    // A visible placeholder while the skeleton/budget runs; the boundary replaces
    // the whole cell with the fallback card once the budget is exceeded.
    const card = this.ownerDocument.createElement('div');
    card.className = 'gm-laggard';
    card.textContent = 'Loading (never settles — demonstrates auto-degrade)…';
    this.replaceChildren(card);
  }
}

/** Register `<gm-laggard-widget>` once; guarded for idempotent import-map loads. */
export function defineLaggardWidget(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(LAGGARD_WIDGET_TAG) !== undefined) return;
  customElements.define(LAGGARD_WIDGET_TAG, LaggardWidget);
}

defineLaggardWidget();
