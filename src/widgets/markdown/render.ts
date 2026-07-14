/**
 * A deliberately-tiny, safe Markdown subset renderer for the markdown demo widget
 * (docs/SPEC.md §5) — pure and DOM-free, so it is unit-testable under Node.
 *
 * The widget is a **same-document** custom element (no iframe, no shadow DOM), so
 * its HTML lands in the host document: rendering untrusted Markdown as raw HTML
 * would be an injection sink. This renderer therefore **escapes first, then adds
 * markup** — every `<`, `&`, `"` in the source is neutralized before any tag is
 * introduced, so no author-supplied text can smuggle an element or attribute in.
 * It is intentionally not CommonMark-complete: it is demo content exercising the
 * static-props ABI, not a general document engine. A production widget would pin
 * a hardened Markdown+sanitizer pair; the rationale for keeping the demo
 * dependency-free is in the PR.
 *
 * Supported: `#`–`###` headings, `-`/`*` unordered lists, `` `code` ``, `**bold**`,
 * `*italic*`, `[text](https://safe-url)`, and blank-line-separated paragraphs.
 */

/** Escape the five HTML-significant characters so source text can never form markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Apply inline spans to an **already-escaped** line: code, bold, italic, links.
 * Order matters — code is extracted first so `*`/`_` inside `` ` `` stay literal.
 */
function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, text: string, href: string) => {
      // Only http(s) links become anchors; anything else (javascript:, data:) is
      // left as inert escaped text, so the link syntax can never introduce a
      // dangerous scheme.
      if (!/^https?:\/\//i.test(href)) return whole;
      return `<a href="${href}" rel="noopener noreferrer" target="_blank">${text}</a>`;
    });
}

/**
 * Render a Markdown-subset `source` to a safe HTML string. Escaping happens per
 * line before any markup is added, so the output only ever contains the tags
 * this renderer itself introduces.
 */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (listItems.length === 0) return;
    html.push(`<ul>${listItems.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    const listItem = /^[-*]\s+(.*)$/.exec(trimmed);

    if (trimmed === '') {
      flushParagraph();
      flushList();
    } else if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
    } else if (listItem !== null) {
      flushParagraph();
      listItems.push(listItem[1]);
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  flushList();
  return html.join('');
}
