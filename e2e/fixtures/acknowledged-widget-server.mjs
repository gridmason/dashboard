/**
 * A stand-in for an **acknowledged**-sideload remote (docs/SPEC.md §4, FR-8), used
 * by the acknowledged-sideload e2e. Unlike the `dev` widget server (which hot
 * re-serves), an acknowledged remote is **hash-pinned at registration**, so its
 * entry module is served with **stable bytes** — the pin the dashboard records must
 * keep matching on every load. It serves the SPEC-literal widget descriptor
 * contract (`src/sideload/manifest.ts`):
 *
 *   GET  /gridmason.widget.json  → { tag, name, entry }        (the descriptor)
 *   GET  /entry.js               → ESM defining <acme-ack-note> (self-contained)
 *   POST /__tamper               → serve DIFFERENT entry bytes  (simulate tampering)
 *   POST /__reset                → serve the original bytes again (test cleanup)
 *
 * The widget is self-contained (it bakes its own text rather than fetching it), so
 * its mounted content is deterministic. Tampering appends a byte-changing marker to
 * `/entry.js` **without** changing the widget's behaviour: the point is that the
 * served bytes no longer hash to the pin, so the dashboard must refuse the load
 * before the module ever runs. Every response carries `Access-Control-Allow-Origin:
 * *`, because a cross-origin ES-module `import()` and the pin fetch are CORS
 * requests.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.ACK_WIDGET_PORT ?? '6071');
const TAG = 'acme-ack-note';
let tampered = false;

const entryModule = (marker) => `
class AckNote extends HTMLElement {
  connectedCallback() {
    this.setAttribute('data-testid', 'ack-note');
    this.style.display = 'block';
    this.style.padding = '10px';
    this.textContent = 'Acknowledged Notes';
  }
}
if (!customElements.get('${TAG}')) customElements.define('${TAG}', AckNote);
export default AckNote;
${marker}
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
    send(res, 200, JSON.stringify({ tag: TAG, name: 'Acked Notes', entry: '/entry.js' }), 'application/json');
  } else if (url.pathname === '/entry.js') {
    // Tampering changes the served bytes (a comment marker) — behaviour is
    // unchanged, but the content no longer matches the pinned hash.
    send(res, 200, entryModule(tampered ? '/* tampered */' : ''), 'text/javascript');
  } else if (url.pathname === '/__tamper' && req.method === 'POST') {
    tampered = true;
    send(res, 200, JSON.stringify({ tampered }), 'application/json');
  } else if (url.pathname === '/__reset' && req.method === 'POST') {
    tampered = false;
    send(res, 200, JSON.stringify({ tampered }), 'application/json');
  } else {
    send(res, 404, 'not found', 'text/plain');
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`acknowledged-widget-server listening on http://localhost:${PORT}`);
});
