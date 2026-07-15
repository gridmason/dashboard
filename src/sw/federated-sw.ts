/**
 * The shell-owned **Service Worker** (docs/SPEC.md §2; FR-11) — the enforcement
 * front-end for the federated release-doc plumbing. It is the only place a federated
 * remote's bytes are fetched, and it does **buffer-verify-serve**: for a URL a
 * verified release claims, it fully buffers the response, checks the exact bytes
 * against the release-listed content hash, and serves **only** on a match. A hash
 * mismatch, or a fetch to a guarded origin the release does not claim, is refused as
 * a **network error** (`Response.error()`) → the importer's `import()` rejects → the
 * widget falls to its error-boundary card. Trust is bound **per URL, not per origin**
 * (../boot/sw/enforcement-table), so two registries sharing a CDN host cannot
 * cross-contaminate. Remotes are never fetched-then-`eval`ed — the SW hands verified
 * bytes to the browser's native ESM loader.
 *
 * **State + fail-closed on restart.** The page hands the SW its enforcement table
 * (the merged `url → hash` map) by `postMessage` after the SW controls the page, and
 * the SW persists it to the Cache API so a *restarted* worker (the browser may kill
 * an idle SW between fetches) re-hydrates the same table on activate — without it the
 * SW would not know which origins are federated territory and could passthrough
 * unverified bytes. A hash is content-addressed (`/v1/artifacts/:hash`), so a stale
 * persisted table can only *lack* a new URL — which is then refused as unclaimed
 * until the page re-hands-off — never serve wrong bytes. Fail closed either way.
 *
 * **Scope.** This SW is FR-11 only (hash verification of federated remotes). The
 * session-token rail (FR-14, #21) augments this same shell-owned worker later; the
 * fetch handler here passes through everything outside federated territory untouched,
 * leaving that surface free.
 *
 * Built as a standalone ES-module entry emitted to the app root (`/federated-sw.js`,
 * vite.config.ts) so it can claim scope `/`. Not exercised by Vitest (no SW globals
 * under Node); its pure decision core (../boot/sw/enforcement-table,
 * ../boot/sw/verify-fetch) is unit-tested, and it is driven end to end by the browser.
 */
import {
  ENFORCEMENT_ACK_TYPE,
  EnforcementTable,
  isEnforcementMessage,
  tableFromMessage,
  type EnforcementAckMessage,
} from '../boot/sw/enforcement-table';
import { verifyBytes } from '../boot/sw/verify-fetch';

// Minimal, local typings for the SW globals this file uses. The project tsconfig
// ships the DOM lib (for the app), which does not declare `ServiceWorkerGlobalScope`
// / `FetchEvent`; pulling in the WebWorker lib program-wide would clash with DOM. So
// the handful of SW-specific shapes are declared here and `self` is cast once. The
// `Cache`/`caches`/`Request`/`Response`/`fetch`/`crypto` globals are DOM-lib-declared
// (WindowOrWorkerGlobalScope) and used directly.
interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface ExtendableMessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
  readonly ports: readonly MessagePort[];
}
interface ServiceWorkerGlobalScopeLike {
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: ExtendableMessageEventLike) => void): void;
}

const sw = self as unknown as ServiceWorkerGlobalScopeLike;

/** Cache + key the persisted enforcement table lives under (a synthetic same-worker request key). */
const TABLE_CACHE = 'gm-sw/enforcement-v1';
const TABLE_KEY = 'https://gm-sw.internal/enforcement-table';

/** The active enforcement table. Replaced wholesale on each page hand-off; hydrated from cache on restart. */
let table = new EnforcementTable();

/** Persist the current table so a restarted worker re-hydrates it (fail closed on restart). */
async function persist(current: EnforcementTable): Promise<void> {
  const cache = await caches.open(TABLE_CACHE);
  await cache.put(new Request(TABLE_KEY), new Response(JSON.stringify(current.entries())));
}

/** Re-hydrate the table from cache (on activate, and lazily if a fetch finds it empty). */
async function hydrate(): Promise<void> {
  const cache = await caches.open(TABLE_CACHE);
  const stored = await cache.match(TABLE_KEY);
  if (stored === undefined) return;
  try {
    const entries = (await stored.json()) as unknown;
    if (Array.isArray(entries)) {
      table = new EnforcementTable(entries as ConstructorParameters<typeof EnforcementTable>[0]);
    }
  } catch {
    // A corrupt cache entry leaves the empty table in place — every guarded fetch is
    // then refused as unclaimed until the page re-hands-off. Fail closed.
  }
}

/** Record a refusal. In-worker telemetry (#22 folds this into the shared sink); stable prefix for log-scraping. */
function reportRefusal(url: string, reason: string): void {
  console.warn(`[gm-sw] refused ${reason}: ${url}`);
}

/**
 * Buffer the response for a claimed URL, verify the exact bytes against the expected
 * hash, and serve only on a match. A mismatch (tampered chunk) — or a transport error
 * — becomes a network error to the importer. Serves the *buffered* bytes, not a live
 * stream, so nothing partially-verified ever reaches the loader.
 */
async function bufferVerifyServe(request: Request, expected: Parameters<typeof verifyBytes>[1]): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(request);
  } catch {
    return Response.error();
  }
  // Let the importer see a real HTTP failure as itself (its own error card), rather
  // than masking a 404/500 as a hash refusal.
  if (!response.ok) return response;

  const buffer = await response.arrayBuffer();
  const verdict = await verifyBytes(new Uint8Array(buffer), expected);
  if (!verdict.ok) {
    reportRefusal(request.url, verdict.reason);
    return Response.error();
  }
  // Serve the exact verified bytes with the original status/headers.
  return new Response(buffer, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

sw.addEventListener('install', (event) => {
  // Activate this worker as soon as it installs so control can be claimed on first
  // visit (paired with `clients.claim()` below) rather than waiting for a navigation.
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await hydrate();
      // Claim existing clients so the page that just registered us comes under control
      // without a reload (the lifecycle's reload is only a fallback, SPEC §2).
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  if (!isEnforcementMessage(event.data)) return;
  table = tableFromMessage(event.data);
  const ack: EnforcementAckMessage = { type: ENFORCEMENT_ACK_TYPE, size: table.size };
  // Persist (best effort), then acknowledge on the reply port so the page knows the
  // table is enforced before it installs any federated remote.
  event.waitUntil(
    persist(table)
      .catch(() => {})
      .finally(() => {
        for (const port of event.ports) port.postMessage(ack);
      }),
  );
});

sw.addEventListener('fetch', (event) => {
  const decision = table.classify(event.request.url);
  switch (decision.kind) {
    case 'passthrough':
      // Not federated territory — the SW is transparent (shell assets, API, etc.).
      return;
    case 'refuse':
      // A guarded origin's unclaimed URL — refused outright (SPEC §2), no fetch.
      reportRefusal(event.request.url, 'unclaimed-url');
      event.respondWith(Response.error());
      return;
    case 'verify':
      event.respondWith(bufferVerifyServe(event.request, decision.expected));
      return;
  }
});
