/**
 * The `gridmason dev` hot-reload SSE transport (docs/SPEC.md §4, FR-7, issue #41)
 * — **development builds only** (reached solely from {@link DevSideloadProvider}).
 *
 * `gridmason dev` streams live-edit signals over Server-Sent Events at
 * {@link DEV_EVENTS_PATH} (real `@gridmason/cli` contract, gridmason/cli
 * docs/dev-server.md — "Hot-reload mechanism"). Each `reload` frame carries the
 * change **category** and a monotonically increasing **generation** token:
 *
 * ```
 * event: reload
 * data: { "category": "source", "generation": 3 }
 * ```
 *
 * | Category | Meaning | Generation |
 * |---|---|---|
 * | `source` | a `src/` file changed | bumped (fresh module graph needed) |
 * | `manifest` | `manifest.json` changed | bumped |
 * | `fixtures` | `fixtures/default.json` changed | reused (data-only) |
 * | `context` | `fixtures/contexts/**` changed | reused (data-only) |
 *
 * The same stream also carries `inspect` frames (the SDK inspector, cli §4) which
 * the dashboard does not consume — this controller listens for `reload` only.
 *
 * This module is **just the transport**: it owns one {@link EventSource} per
 * admitted dev origin and forwards each parsed `reload` frame to its `onReload`
 * callback. What to *do* with a reload (re-import the entry, remount the widget)
 * is the provider's reaction, kept out of here so this stays unit-testable with a
 * fake `EventSource` and no network. Connections open/close as origins join and
 * leave the session allowlist ({@link DevReloadController.setOrigins}), and
 * {@link DevReloadController.close} tears every one down when the dev gate is
 * revoked or the provider unmounts.
 */

/** The `gridmason dev` SSE hot-reload stream (real `@gridmason/cli` contract). */
export const DEV_EVENTS_PATH = '/@dev/events';

/** The `gridmason dev` reload categories (cli docs/dev-server.md). */
export type DevReloadCategory = 'source' | 'manifest' | 'fixtures' | 'context';

/** Whether a reload category needs a fresh module graph (a cache-busting re-import). */
export function reloadNeedsReimport(category: DevReloadCategory): boolean {
  return category === 'source' || category === 'manifest';
}

/** One parsed `reload` frame from the dev-server SSE stream. */
export interface DevReloadFrame {
  /** The change category the edit fell into. */
  readonly category: DevReloadCategory;
  /** The cache-busting generation token (bumped only for `source`/`manifest`). */
  readonly generation: number;
}

const RELOAD_CATEGORIES: ReadonlySet<string> = new Set<DevReloadCategory>([
  'source',
  'manifest',
  'fixtures',
  'context',
]);

/**
 * Parse a `reload` frame's JSON `data` payload. Total — returns `undefined` for
 * malformed JSON, an unknown category, or a non-numeric generation, so a stray
 * frame is ignored rather than crashing the listener.
 */
export function parseReloadFrame(data: string): DevReloadFrame | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const { category, generation } = record;
  if (typeof category !== 'string' || !RELOAD_CATEGORIES.has(category)) return undefined;
  if (typeof generation !== 'number' || !Number.isFinite(generation)) return undefined;
  return { category: category as DevReloadCategory, generation };
}

/**
 * The minimal `EventSource` surface this controller drives — enough to subscribe
 * to named `reload` frames and tear a connection down. The global `EventSource`
 * satisfies it; a test supplies a fake so the transport runs without a network.
 */
export interface EventSourceLike {
  addEventListener(type: 'reload', listener: (event: { data: string }) => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
  close(): void;
}

/** Constructs an {@link EventSourceLike} for a stream URL (injectable for tests). */
export type EventSourceFactory = (url: string) => EventSourceLike;

/** How the controller reports parsed frames and (best-effort) stream errors. */
export interface DevReloadControllerOptions {
  /** Called with every well-formed `reload` frame, tagged with its origin. */
  readonly onReload: (origin: string, frame: DevReloadFrame) => void;
  /**
   * Constructs the `EventSource` for an origin's stream. Defaults to the global
   * `EventSource`; tests inject a fake. Absent a global (non-browser build), the
   * controller becomes inert rather than throwing.
   */
  readonly eventSourceFactory?: EventSourceFactory;
  /** Best-effort stream-error notification (a dropped connection auto-reconnects). */
  readonly onError?: (origin: string, error: unknown) => void;
}

function defaultFactory(): EventSourceFactory | undefined {
  const ctor = (globalThis as { EventSource?: new (url: string) => EventSourceLike }).EventSource;
  return ctor === undefined ? undefined : (url) => new ctor(url);
}

/**
 * Manages one hot-reload `EventSource` per admitted dev origin. The provider keeps
 * {@link setOrigins} in step with the session allowlist: a newly admitted origin
 * opens a stream, a removed one closes it. Idempotent — re-passing the same origin
 * set is a no-op, so it can be driven from a React effect that fires on every
 * allowlist change.
 */
export class DevReloadController {
  readonly #onReload: DevReloadControllerOptions['onReload'];
  readonly #onError: DevReloadControllerOptions['onError'];
  readonly #factory: EventSourceFactory | undefined;
  readonly #streams = new Map<string, EventSourceLike>();

  constructor(options: DevReloadControllerOptions) {
    this.#onReload = options.onReload;
    this.#onError = options.onError;
    this.#factory = options.eventSourceFactory ?? defaultFactory();
  }

  /**
   * Reconcile the open streams to `origins`: open one for each newly admitted
   * origin, close the stream of any origin no longer present. Origins already
   * connected are left untouched (no reconnect churn).
   */
  setOrigins(origins: readonly string[]): void {
    const wanted = new Set(origins);
    for (const [origin, stream] of this.#streams) {
      if (!wanted.has(origin)) {
        stream.close();
        this.#streams.delete(origin);
      }
    }
    for (const origin of wanted) {
      if (!this.#streams.has(origin)) this.#open(origin);
    }
  }

  /** Close every open stream (dev gate revoked, or the provider unmounted). */
  close(): void {
    for (const stream of this.#streams.values()) stream.close();
    this.#streams.clear();
  }

  /** The origins with an open stream — the observable state the tests assert on. */
  origins(): readonly string[] {
    return [...this.#streams.keys()];
  }

  #open(origin: string): void {
    if (this.#factory === undefined) return; // no EventSource (non-browser) → inert
    const url = new URL(DEV_EVENTS_PATH, origin.endsWith('/') ? origin : `${origin}/`).href;
    const stream = this.#factory(url);
    stream.addEventListener('reload', (event) => {
      const frame = parseReloadFrame(event.data);
      if (frame !== undefined) this.#onReload(origin, frame);
    });
    stream.addEventListener('error', (error) => this.#onError?.(origin, error));
    this.#streams.set(origin, stream);
  }
}
