/**
 * A contract-faithful stand-in for `gridmason dev` (docs/SPEC.md §4), used by the
 * dev-sideload e2e until `@gridmason/cli` is published (gridmason/cli#28). It
 * serves an ES-module widget entry on a localhost origin and hot re-serves —
 * exactly what SPEC §4 says `gridmason dev` does — against the SPEC-literal
 * serving contract the dashboard registers with (`src/sideload/manifest.ts`):
 *
 *   GET /gridmason.widget.json  → { tag, name, entry }        (the descriptor)
 *   GET /entry.js               → ESM defining <acme-dev-note> (the widget)
 *   GET /content                → { text }                    (live content)
 *   POST /__bump                → re-serve: bump the content   (author-loop edit)
 *
 * The widget fetches `/content` on mount rather than baking its text into the
 * module, because a custom element cannot be re-`define`d — so the author loop
 * (re-serve → the running dashboard reflects the change) is demonstrated by a new
 * mount picking up the re-served content. Every response carries `Access-Control-
 * Allow-Origin: *`, because a cross-origin ES-module `import()` and the content
 * `fetch` are both CORS requests.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.DEV_WIDGET_PORT ?? '6070');
const TAG = 'acme-dev-note';
let version = 1;

const ENTRY = `
const origin = new URL(import.meta.url).origin;
class DevNote extends HTMLElement {
  async connectedCallback() {
    this.setAttribute('data-testid', 'dev-note');
    this.style.display = 'block';
    this.style.padding = '10px';
    this.textContent = 'Field Notes (loading…)';
    try {
      const res = await fetch(origin + '/content');
      const { text } = await res.json();
      this.textContent = text;
    } catch {
      this.textContent = 'Field Notes (offline)';
    }
  }
}
if (!customElements.get('${TAG}')) customElements.define('${TAG}', DevNote);
export default DevNote;
`;

function send(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/gridmason.widget.json') {
    send(res, 200, JSON.stringify({ tag: TAG, name: 'Field Notes', entry: '/entry.js' }), 'application/json');
  } else if (url.pathname === '/entry.js') {
    send(res, 200, ENTRY, 'text/javascript');
  } else if (url.pathname === '/content') {
    send(res, 200, JSON.stringify({ text: `Field Notes v${version}` }), 'application/json');
  } else if (url.pathname === '/__bump' && req.method === 'POST') {
    version += 1;
    send(res, 200, JSON.stringify({ version }), 'application/json');
  } else {
    send(res, 404, 'not found', 'text/plain');
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`dev-widget-server listening on http://localhost:${PORT}`);
});
