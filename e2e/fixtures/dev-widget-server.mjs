/**
 * A hermetic stand-in for `gridmason dev` (docs/SPEC.md §4), used by the
 * dev-sideload e2e. It mirrors the **real** `@gridmason/cli` serving contract
 * (gridmason/cli#28, verified against `@gridmason/cli@0.0.1` for issue #38) that
 * the dashboard's dev-sideload seam (`src/sideload/manifest.ts`) reads:
 *
 *   GET  /@dev/manifest  → { valid, violations, tag, entry }   (live-validated manifest)
 *   GET  /manifest.json  → the raw manifest (carries the display `name`)
 *   GET  /src/entry.js   → ESM defining <acme-dev-note>         (the widget entry)
 *   GET  /@dev/events    → text/event-stream hot-reload signal  (SSE)
 *   GET  /content        → { text }                             (live content)
 *   POST /__bump         → re-serve: bump the content + emit an SSE `reload`
 *
 * Unlike a real scaffolded widget (whose entry imports `@gridmason/sdk` by bare
 * specifier and so needs an import map the dashboard does not yet provide — see
 * docs/sideload.md and the #38 verdict), this stand-in widget is **self-contained**:
 * it fetches `/content` on mount rather than importing anything, so it loads with
 * no shared scope and the hermetic e2e stays a pure test of the transport +
 * governance path. The author loop (re-serve → the running dashboard reflects the
 * change) is demonstrated by a new mount picking up the re-served content, because
 * a custom element cannot be re-`define`d. Every response carries `Access-Control-
 * Allow-Origin: *`, because a cross-origin ES-module `import()` and the content
 * `fetch` are both CORS requests.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.DEV_WIDGET_PORT ?? '6070');
const TAG = 'acme-dev-note';
const ENTRY_PATH = 'src/entry.js';
let version = 1;
let generation = 1;

const MANIFEST = {
  formatVersion: '1.0',
  tag: TAG,
  kind: 'widget',
  name: 'Field Notes',
  publisher: 'acme',
  version: '0.1.0',
  entry: ENTRY_PATH,
};

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

/** Connected SSE clients, so `/__bump` can announce a reload like real `gridmason dev`. */
const sseClients = new Set();

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
  if (url.pathname === '/@dev/manifest') {
    send(res, 200, JSON.stringify({ valid: true, violations: [], tag: TAG, entry: ENTRY_PATH }), 'application/json');
  } else if (url.pathname === '/manifest.json') {
    send(res, 200, JSON.stringify(MANIFEST), 'application/json');
  } else if (url.pathname === '/' + ENTRY_PATH) {
    send(res, 200, ENTRY, 'text/javascript');
  } else if (url.pathname === '/@dev/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  } else if (url.pathname === '/content') {
    send(res, 200, JSON.stringify({ text: `Field Notes v${version}` }), 'application/json');
  } else if (url.pathname === '/__bump' && req.method === 'POST') {
    version += 1;
    generation += 1;
    const payload = JSON.stringify({ category: 'source', generation });
    for (const client of sseClients) client.write(`event: reload\ndata: ${payload}\n\n`);
    send(res, 200, JSON.stringify({ version, generation }), 'application/json');
  } else {
    send(res, 404, 'not found', 'text/plain');
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`dev-widget-server listening on http://localhost:${PORT}`);
});
