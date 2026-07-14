/**
 * `gm-markdown-widget` — a static Markdown-notes demo widget (docs/SPEC.md §5).
 *
 * Static minimal props: it renders the `markdown` string from its `settings`
 * (falling back to `content`/`text`) through the safe subset renderer in
 * `render.ts`. No context, no SDK, synchronous — like the clock it never shows a
 * skeleton. Same-document custom element, themed via CSS custom properties.
 *
 * The rendered HTML is safe by construction (`renderMarkdown` escapes before it
 * adds markup), so assigning `innerHTML` here cannot inject host-document markup.
 */

import { WIDGET_TAGS } from '../../boot/import-map';
import { readSettings, readStringProp } from '../abi';
import { renderMarkdown } from './render';
import './markdown.css';

/** The custom-element tag, sourced from the import map (`../../boot/import-map`). */
export const MARKDOWN_WIDGET_TAG = WIDGET_TAGS.markdown;

/** Attributes that, when changed by the canvas, should re-render. */
const OBSERVED = ['settings'] as const;

/** Read the widget's Markdown source from any of the accepted prop aliases. */
function readSource(settings: Readonly<Record<string, unknown>>): string {
  for (const key of ['markdown', 'content', 'text']) {
    const value = settings[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '_No content._';
}

class MarkdownWidget extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  connectedCallback(): void {
    this.#render();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.#render();
  }

  #render(): void {
    const settings = readSettings(this);
    const label = readStringProp(settings, 'label', '');

    this.replaceChildren();
    const card = this.ownerDocument.createElement('article');
    card.className = 'gm-markdown';

    if (label.length > 0) {
      const title = this.ownerDocument.createElement('h2');
      title.className = 'gm-markdown__label';
      title.textContent = label;
      card.append(title);
    }

    const body = this.ownerDocument.createElement('div');
    body.className = 'gm-markdown__body';
    // Safe: `renderMarkdown` escapes source text before adding markup, so the
    // only tags present are the ones it emits (SPEC §5 — same-document widget).
    body.innerHTML = renderMarkdown(readSource(settings));
    card.append(body);

    this.append(card);
  }
}

/** Register `<gm-markdown-widget>` once; guarded for idempotent import-map loads. */
export function defineMarkdownWidget(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(MARKDOWN_WIDGET_TAG) !== undefined) return;
  customElements.define(MARKDOWN_WIDGET_TAG, MarkdownWidget);
}

defineMarkdownWidget();
