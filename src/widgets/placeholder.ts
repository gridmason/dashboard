/**
 * Phase-A placeholder widget (docs/SPEC.md §5).
 *
 * **Scaffolding, not a demo widget.** The four demo page types need *some*
 * registered custom element so their default layouts render through `PageCanvas`
 * (import map → lazy `import()` → element registered → mount) before the
 * first-party demo widgets exist. This element is that stand-in: a labelled card
 * that echoes the ABI inputs the shell drives it with. The real demo widgets
 * (clock, markdown, record-summary, chart, crasher) land in #6 and replace both
 * this module and the placeholder entries in the local import map
 * (`../boot/import-map`).
 *
 * It observes the widget ABI (`@gridmason/core` PageCanvas/abi): `settings`
 * (JSON props — reads a `label`), `context` (JSON page context — shows whether a
 * typed context is present), and `instance-id`. Importing this module registers
 * the element as a side effect (the import map's `load` thunk), guarded so a
 * repeated activation never triggers the `customElements.define` collision.
 */

import { PLACEHOLDER_WIDGET_TAG } from '../boot/import-map';
import './placeholder.css';

/** The ABI attributes this element reacts to (mirrors core PageCanvas/abi `ABI_ATTR`). */
const OBSERVED = ['settings', 'context', 'instance-id'] as const;

/** Parse a JSON ABI attribute, tolerating the absent/malformed case (never throws). */
function parseJson(value: string | null): unknown {
  if (value === null || value === '') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** The `label` prop from the serialized `settings`, or a neutral default. */
function readLabel(settings: unknown): string {
  if (typeof settings === 'object' && settings !== null && 'label' in settings) {
    const label = (settings as { label: unknown }).label;
    if (typeof label === 'string' && label.length > 0) return label;
  }
  return 'Widget';
}

class PlaceholderWidget extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  connectedCallback(): void {
    this.#render();
  }

  attributeChangedCallback(): void {
    // Cheap enough to re-render wholesale; the element holds no interactive state.
    if (this.isConnected) this.#render();
  }

  #render(): void {
    const label = readLabel(parseJson(this.getAttribute('settings')));
    // A page with no context serializes to JSON `null` on the ABI attribute
    // (core's `serializeContext`), so treat both absent and null as "no context".
    const contextValue = parseJson(this.getAttribute('context'));
    const hasContext = contextValue !== undefined && contextValue !== null;
    const instanceId = this.getAttribute('instance-id') ?? '';

    this.replaceChildren();
    const card = this.ownerDocument.createElement('div');
    card.className = 'gm-placeholder';
    card.dataset.instanceId = instanceId;

    const title = this.ownerDocument.createElement('strong');
    title.className = 'gm-placeholder__label';
    title.textContent = label;

    const note = this.ownerDocument.createElement('span');
    note.className = 'gm-placeholder__note';
    note.textContent = hasContext ? 'context: provided' : 'context: none';

    card.append(title, note);
    this.append(card);
  }
}

/**
 * Register the placeholder element, once. Guarded on `customElements.get` so the
 * import map's `load` thunk is idempotent (React StrictMode re-runs, repeated
 * page activations) and never throws the define-time collision.
 */
export function definePlaceholderWidget(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(PLACEHOLDER_WIDGET_TAG) !== undefined) return;
  customElements.define(PLACEHOLDER_WIDGET_TAG, PlaceholderWidget);
}

definePlaceholderWidget();
