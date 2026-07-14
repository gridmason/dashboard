/**
 * `gm-clock-widget` — a live clock demo widget (docs/SPEC.md §5).
 *
 * The simplest ABI shape: **static minimal props**, no context, no SDK. It reads
 * its display options from `settings` (`format`, `showSeconds`, `timeZone`,
 * `label`) and ticks once a second. Being a trivial, synchronous widget it
 * dispatches no `gm:loading`/`gm:ready` — core's boundary treats it as
 * interactive the moment `connectedCallback` returns (no skeleton).
 *
 * Framework-agnostic: a same-document custom element (no shadow DOM, no iframe,
 * nothing React), themed entirely through the CSS custom properties in
 * `clock.css`.
 */

import { WIDGET_TAGS } from '../../boot/import-map';
import { readSettings, readStringProp } from '../abi';
import { formatClock, readClockOptions, type ClockOptions } from './format';
import './clock.css';

/** The custom-element tag, sourced from the import map (`../../boot/import-map`). */
export const CLOCK_WIDGET_TAG = WIDGET_TAGS.clock;

/** Attributes that, when changed by the canvas, should re-read + re-render. */
const OBSERVED = ['settings'] as const;

class ClockWidget extends HTMLElement {
  #timer: ReturnType<typeof setInterval> | undefined;
  #timeEl: HTMLTimeElement | undefined;
  #options: ClockOptions = { hour12: false, showSeconds: false, timeZone: undefined };

  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  connectedCallback(): void {
    this.#build();
    // Tick every second; the widget owns the interval and clears it on disconnect
    // so a torn-down instance (tab switch, retry, virtualization) leaves no timer.
    this.#timer = setInterval(() => this.#tick(), 1000);
  }

  disconnectedCallback(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.#build();
  }

  /** (Re)build the card from the current `settings` and paint the first tick. */
  #build(): void {
    const settings = readSettings(this);
    this.#options = readClockOptions(settings);
    const label = readStringProp(settings, 'label', 'Clock');

    this.replaceChildren();
    const card = this.ownerDocument.createElement('div');
    card.className = 'gm-clock';

    const title = this.ownerDocument.createElement('span');
    title.className = 'gm-clock__label';
    title.textContent = label;

    const time = this.ownerDocument.createElement('time');
    time.className = 'gm-clock__time';

    card.append(title, time);
    this.append(card);
    this.#timeEl = time;
    this.#tick();
  }

  /** Repaint just the time text — cheap enough to run every second. */
  #tick(): void {
    if (this.#timeEl === undefined) return;
    const now = new Date();
    this.#timeEl.textContent = formatClock(now, this.#options);
    this.#timeEl.dateTime = now.toISOString();
  }
}

/** Register `<gm-clock-widget>` once; guarded so the import-map load thunk is idempotent. */
export function defineClockWidget(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(CLOCK_WIDGET_TAG) !== undefined) return;
  customElements.define(CLOCK_WIDGET_TAG, ClockWidget);
}

defineClockWidget();
