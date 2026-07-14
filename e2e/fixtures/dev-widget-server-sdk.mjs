/**
 * A hermetic stand-in for `gridmason dev` serving a widget whose entry imports
 * `@gridmason/*` by **bare specifier** (docs/SPEC.md §4, issue #40) — the case the
 * self-contained `dev-widget-server.mjs` deliberately avoids.
 *
 * It mirrors the same real `@gridmason/cli` contract the dashboard's seam reads
 * (`/@dev/manifest`, `/manifest.json`, the verbatim entry, `/@dev/events` SSE), but
 * its widget entry does what a scaffold-template widget does: `import … from
 * '@gridmason/sdk'` and `'@gridmason/protocol'`. Those bare specifiers only resolve
 * because the dashboard's dev server injects the `@gridmason/*` import map
 * (`vite/dev-sideload-import-scope.ts`); if it did not, the module would throw
 * `Failed to resolve module specifier` at load and the element would never upgrade.
 * So the widget mounting at all is the proof the scope works — the rendered text is
 * a bonus assertion that the imported values are the real runtime exports.
 *
 * Every response carries `Access-Control-Allow-Origin: *` because a cross-origin
 * ES-module `import()` is a CORS request.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.SDK_WIDGET_PORT ?? '6072');
const TAG = 'sdk-note';
const ENTRY_PATH = 'src/entry.js';

const MANIFEST = {
  formatVersion: '1.0',
  tag: TAG,
  kind: 'widget',
  name: 'SDK Note',
  publisher: 'acme',
  version: '0.1.0',
  entry: ENTRY_PATH,
};

// The entry a scaffold-template widget produces: it imports the SDK (and protocol)
// by bare specifier. `CAPABILITY_APIS` (re-exported by the SDK root from protocol)
// and `SIDELOAD_PREFIX` are stable runtime exports, so referencing them proves the
// resolved module is the real package, not a stub.
const ENTRY = `
import { CAPABILITY_APIS } from '@gridmason/sdk';
import { SIDELOAD_PREFIX } from '@gridmason/protocol';

class SdkNote extends HTMLElement {
  connectedCallback() {
    this.setAttribute('data-testid', 'sdk-note');
    this.style.display = 'block';
    this.style.padding = '10px';
    const sdkOk = CAPABILITY_APIS !== undefined && CAPABILITY_APIS !== null;
    const protoOk = typeof SIDELOAD_PREFIX === 'string' && SIDELOAD_PREFIX.length > 0;
    this.textContent = sdkOk && protoOk ? 'SDK import ok' : 'SDK import missing';
  }
}
if (!customElements.get('${TAG}')) customElements.define('${TAG}', SdkNote);
export default SdkNote;
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
  if (url.pathname === '/@dev/manifest') {
    send(res, 200, JSON.stringify({ valid: true, violations: [], tag: TAG, entry: ENTRY_PATH }), 'application/json');
  } else if (url.pathname === '/manifest.json') {
    send(res, 200, JSON.stringify(MANIFEST), 'application/json');
  } else if (url.pathname === '/' + ENTRY_PATH) {
    send(res, 200, ENTRY, 'text/javascript');
  } else if (url.pathname === '/@dev/events') {
    // The dashboard opens this SSE stream on register; hold it open (this fixture
    // never hot-reloads, so it emits no `reload` frames).
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
  } else {
    send(res, 404, 'not found', 'text/plain');
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`dev-widget-server-sdk listening on http://localhost:${PORT}`);
});
