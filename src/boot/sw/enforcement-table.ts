/**
 * The **enforcement table** the D-E4 Service Worker consults per fetch (docs/SPEC.md
 * §2; FR-11) — the pure, isomorphic core of buffer-verify-serve, split out of the SW
 * script so it is unit-tested under Node (Vitest env is node-only, no SW globals).
 *
 * The federated boot produces a `url → content-hash` map — every servable URL of
 * every verified release, keyed by exact URL (../federated-boot `urlHashes`). This
 * module wraps that map as the SW's decision table. For a fetch the SW classifies the
 * request into one of three:
 *
 * - **`verify`** — the exact URL is claimed by a verified release. The SW buffers the
 *   response, checks its bytes against `expected`, and serves only on a match
 *   (../boot/sw/verify-fetch). Trust is bound to the **exact URL**, never the origin.
 * - **`refuse`** — the URL's origin serves at least one claimed URL (it is federated
 *   territory) but *this* URL is claimed by no release. Refused outright (SPEC §2:
 *   "a fetched URL no release document claims is refused"). This is what stops two
 *   registries sharing a CDN host from cross-contaminating: an unclaimed path on a
 *   guarded origin never serves, even though the origin hosts verified artifacts.
 * - **`passthrough`** — the URL is on no guarded origin (the shell's own assets, the
 *   API, anything unrelated to federation). The SW does not intercept it.
 *
 * The set of **guarded origins is derived from the table itself** — the origins of
 * the claimed URLs — so the host hands the SW exactly one thing (the url→hash map)
 * and the "which origins are federated territory" question answers itself. A release
 * lists every file its runtime may load, so anything a guarded origin serves that the
 * table does not name is genuinely unclaimed and refused (fail closed).
 *
 * Pure and isomorphic: no I/O, no SW globals, no clock. The only web API it touches
 * is `URL` (origin parsing), present in the browser, the SW, and Node.
 */
import type { MultihashString } from '@gridmason/protocol/verify';

/** One `[url, hash]` pair — a servable URL and the content hash a verified release listed for it. */
export type EnforcementEntry = readonly [url: string, hash: MultihashString];

/** The `postMessage` type tag carrying the enforcement table from page to SW. */
export const ENFORCEMENT_MESSAGE_TYPE = 'gm-sw/enforcement-table';
/** The `postMessage` type tag the SW replies with once it has installed a table. */
export const ENFORCEMENT_ACK_TYPE = 'gm-sw/enforcement-ack';

/** The page → SW message installing the enforcement table (structured-clone-safe: a tag + plain pairs). */
export interface EnforcementTableMessage {
  readonly type: typeof ENFORCEMENT_MESSAGE_TYPE;
  readonly entries: readonly EnforcementEntry[];
}

/** The SW → page acknowledgement that a table of `size` entries is now enforced. */
export interface EnforcementAckMessage {
  readonly type: typeof ENFORCEMENT_ACK_TYPE;
  readonly size: number;
}

/**
 * How the SW must handle one request:
 * - `verify` — buffer + hash-check against `expected` (a claimed URL);
 * - `refuse` — a guarded origin's unclaimed URL, refused outright (fail closed);
 * - `passthrough` — not federated territory; the SW does not intercept.
 */
export type RequestClass =
  | { readonly kind: 'verify'; readonly expected: MultihashString }
  | { readonly kind: 'refuse' }
  | { readonly kind: 'passthrough' };

/** Normalize a URL for stable matching; the raw string if it is not a parseable absolute URL. */
function normalizeUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/** The origin of a URL, or `null` if it does not parse (a relative or malformed string). */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The SW's per-fetch decision table: a `url → hash` map plus the guarded-origin set
 * derived from it. Immutable once constructed; the SW replaces the whole instance
 * when the page hands off a new table (a killed remote's URL simply stops appearing).
 */
export class EnforcementTable {
  private readonly hashes: ReadonlyMap<string, MultihashString>;
  private readonly guarded: ReadonlySet<string>;

  constructor(entries: Iterable<EnforcementEntry> = []) {
    const hashes = new Map<string, MultihashString>();
    const guarded = new Set<string>();
    for (const [url, hash] of entries) {
      const key = normalizeUrl(url);
      hashes.set(key, hash);
      const origin = originOf(key);
      if (origin !== null) guarded.add(origin);
    }
    this.hashes = hashes;
    this.guarded = guarded;
  }

  /** How many URLs the table claims. */
  get size(): number {
    return this.hashes.size;
  }

  /**
   * Classify a request URL: `verify` (claimed, with its expected hash), `refuse`
   * (guarded origin but unclaimed URL), or `passthrough` (not a guarded origin).
   */
  classify(url: string): RequestClass {
    const key = normalizeUrl(url);
    const expected = this.hashes.get(key);
    if (expected !== undefined) return { kind: 'verify', expected };
    const origin = originOf(key);
    if (origin !== null && this.guarded.has(origin)) return { kind: 'refuse' };
    return { kind: 'passthrough' };
  }

  /** The claimed `[url, hash]` pairs (normalized URLs), for serialization to the SW. */
  entries(): EnforcementEntry[] {
    return [...this.hashes];
  }

  /** This table as the page → SW install message. */
  toMessage(): EnforcementTableMessage {
    return { type: ENFORCEMENT_MESSAGE_TYPE, entries: this.entries() };
  }
}

/** Build an enforcement table from the federated boot's merged `url → hash` map. */
export function enforcementTableFrom(
  urlHashes: ReadonlyMap<string, MultihashString>,
): EnforcementTable {
  return new EnforcementTable(urlHashes);
}

/** A structural guard for the page → SW install message (the SW trusts no `data` shape blindly). */
export function isEnforcementMessage(data: unknown): data is EnforcementTableMessage {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  if (record['type'] !== ENFORCEMENT_MESSAGE_TYPE) return false;
  if (!Array.isArray(record['entries'])) return false;
  return record['entries'].every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'string',
  );
}

/** Rebuild the enforcement table from a validated install message (SW side). */
export function tableFromMessage(message: EnforcementTableMessage): EnforcementTable {
  return new EnforcementTable(message.entries);
}
