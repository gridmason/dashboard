import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMarkdown } from './render';

describe('escapeHtml', () => {
  it('neutralizes every HTML-significant character', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;',
    );
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
});

describe('renderMarkdown', () => {
  it('renders headings, paragraphs, and lists', () => {
    const html = renderMarkdown('# Title\n\nA paragraph.\n\n- one\n- two');
    expect(html).toBe('<h1>Title</h1><p>A paragraph.</p><ul><li>one</li><li>two</li></ul>');
  });

  it('renders inline code, bold, and italic', () => {
    expect(renderMarkdown('use `npm` to **build** and *test*')).toBe(
      '<p>use <code>npm</code> to <strong>build</strong> and <em>test</em></p>',
    );
  });

  it('only makes http(s) links into anchors, leaving other schemes inert', () => {
    expect(renderMarkdown('[docs](https://gridmason.dev)')).toBe(
      '<p><a href="https://gridmason.dev" rel="noopener noreferrer" target="_blank">docs</a></p>',
    );
    // A javascript: URL is not linkified — it stays escaped literal text.
    const evil = renderMarkdown('[x](javascript:alert(1))');
    expect(evil).not.toContain('<a ');
    expect(evil).toContain('javascript:alert(1)');
  });

  it('escapes source before adding markup, so injected tags cannot survive', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes text inside a heading', () => {
    expect(renderMarkdown('# <b>hi</b>')).toBe('<h1>&lt;b&gt;hi&lt;/b&gt;</h1>');
  });
});
