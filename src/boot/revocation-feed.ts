/**
 * Boot step 3.5 — **revocation & kill-feed consumption** (docs/SPEC.md §2, FR-12;
 * gridmason/registry `docs/api/revocation-feed.md`, milestone M-B2).
 *
 * ```
 * boot → gate snapshot (../boot/gate-snapshot)
 *   → registry resolution API (../boot/resolution-client)
 *   → revocation feed check (per registry: cursor + TTL + kill)  ← this module
 *   → import map assembled (../boot/import-map-assembly, filtered by ../boot/revocation-gate)
 *   → lazy verified import()  (#16)
 * ```
 *
 * The gate is the kill switch (SPEC §2): a disabled or **revoked/killed** remote
 * never enters the import map. Enablement is the host's (the gate snapshot);
 * **distribution state** is each registry's — published in a signed, monotonic
 * *revocation & kill feed* the host polls (registry SPEC §6, the §6 ownership
 * contract). This module is the host's half: for **each** trusted registry it
 * fetches that registry's feed, verifies its signature, and runs the protocol's
 * `evaluateFreshness` cursor/TTL gate — yielding a per-registry verdict that
 * {@link ../boot/revocation-gate} applies to the resolved remotes.
 *
 * **Freshness is per registry, and failure is fail-closed *scoped to that
 * registry only*** (SPEC §2). A host trusting N registries keeps N cursors and N
 * TTL clocks. If one registry's feed is stale (past TTL), unreachable,
 * unverifiable, or rolled back, only **that** registry's remotes fail closed —
 * every other registry, and all local/sideloaded remotes, keep working. This
 * module realizes the scoping by checking each registry **independently** (one
 * verdict per registry, never a shared failure) and *never throwing* for a feed
 * problem: a fetch/verify/staleness failure becomes a fail-closed verdict for its
 * own registry, so one bad feed can never abort the boot or touch another
 * registry.
 *
 * **Signature verification is an injected seam.** The served document is the
 * protocol `RevocationFeed` plus a detached registry signature over its canonical
 * bytes (registry SPEC §6: ECDSA P-256/SHA-256 over `canonicalize(feed)`, the same
 * countersign key that approves releases). `@gridmason/protocol@0.3.0` ships the
 * freshness gate (`evaluateFreshness`) and the canonicalizer (`canonicalize`) but
 * **not** a public primitive that verifies this detached feed signature against a
 * pinned countersign root (its cert/DER primitives are internal to
 * `verifySignatureEnvelope`, which only accepts the dual-signature *release*
 * envelope, a different shape). So — exactly as every other boot step defers
 * verification to a dedicated later stage (resolution-client carries bundles
 * untouched for #16; the SW verifies by URL for #19) — this module takes the feed
 * verifier as a {@link FeedSignatureVerifier} the host wires in. A verifier that
 * rejects, or throws, or is absent for a feed, fails that registry closed. See the
 * PR note: a `verifyRevocationFeed` primitive is owed by `@gridmason/protocol`
 * (protocol #16/#17, composed in `verifyRelease` #20).
 */
import type {
  BlockedArtifact,
  Cursor,
  FreshnessVerdictCode,
  RevocationFeed,
} from '@gridmason/protocol';
import { evaluateFreshness } from '@gridmason/protocol';

/**
 * The detached registry signature over a feed's canonical bytes (registry SPEC §6).
 * `cert` is the base64 DER countersign certificate, `sig` the base64 raw ECDSA
 * signature (IEEE-P1363) over `canonicalize(feed)`. This module models the wire
 * shape only — validity is the {@link FeedSignatureVerifier}'s to decide.
 */
export interface FeedSignature {
  /** Signature algorithm; `ES256` at the current feed format. */
  readonly alg: string;
  /** Base64 (standard alphabet) DER-encoded countersign certificate. */
  readonly cert: string;
  /** Base64 (standard alphabet) raw ECDSA signature (IEEE-P1363) over the canonical feed bytes. */
  readonly sig: string;
}

/**
 * The served revocation-feed document: the protocol {@link RevocationFeed} plus its
 * detached {@link FeedSignature} (registry SPEC §6, `GET /v1/revocation/feed`). The
 * host reconstructs the canonical bytes from `feed`, checks `signature` against its
 * pinned countersign root, then passes `feed` to `evaluateFreshness`.
 */
export interface SignedRevocationFeed {
  /** The signed feed body — everything `evaluateFreshness` needs. */
  readonly feed: RevocationFeed;
  /** The detached registry signature over `canonicalize(feed)`. */
  readonly signature: FeedSignature;
}

/**
 * Verifies a served feed's detached signature against the host's pinned countersign
 * root (registry SPEC §6). Injected because `@gridmason/protocol@0.3.0` exposes no
 * public feed-signature primitive (see the module note) — the host supplies one
 * (WebCrypto over `canonicalize(feed)`, the countersign root pinned at build/deploy
 * time). Returns `true` iff the signature holds; a return of `false`, a rejected
 * promise, or a thrown error all fail the feed's registry closed. Sync or async.
 */
export type FeedSignatureVerifier = (
  signed: SignedRevocationFeed,
) => boolean | Promise<boolean>;

/**
 * A host's per-registry cursor store (registry SPEC §6: one cursor per registry).
 * Holds the highest feed `seq` accepted for each registry so a replayed older feed
 * is caught as a rollback. {@link get} returns a fresh `-1` cursor for a registry
 * never seen (feeds start at `0`, so `-1` accepts the first feed of any `seq`).
 */
export interface CursorStore {
  /** The stored cursor for `registryId`, or a `{ registryId, seq: -1 }` cursor if none. */
  get(registryId: string): Cursor;
  /** Record the highest accepted `seq` for `cursor.registryId`. */
  set(cursor: Cursor): void;
}

/**
 * The default in-memory {@link CursorStore}: cursors advance for the lifetime of the
 * client (a boot session, or a long-lived poller), so a rollback within that window
 * is rejected. A durable backing (so rollback protection survives a reload) is a
 * documented follow-up — the store is isolated behind this interface so one can be
 * swapped in without touching the client.
 */
export class InMemoryCursorStore implements CursorStore {
  readonly #cursors = new Map<string, Cursor>();

  get(registryId: string): Cursor {
    return this.#cursors.get(registryId) ?? { registryId, seq: -1 };
  }

  set(cursor: Cursor): void {
    this.#cursors.set(cursor.registryId, cursor);
  }
}

/** Options for {@link RevocationFeedClient}. */
export interface RevocationFeedClientOptions {
  /** Verifies each served feed's detached signature (see {@link FeedSignatureVerifier}). */
  readonly verifier: FeedSignatureVerifier;
  /** Per-registry cursor store. Defaults to a fresh {@link InMemoryCursorStore}. */
  readonly cursors?: CursorStore;
  /** `fetch` implementation. Defaults to the global — overridden in tests. */
  readonly fetchImpl?: typeof fetch;
  /** Clock (epoch ms) supplied to `evaluateFreshness`. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Which trusted registry's feed to check, and where to fetch it. */
export interface RegistryFeedEndpoint {
  /**
   * The registry's id — the key the cursor is stored under and the id the served
   * feed must name (`feed.registryId`); a served feed claiming a different id is a
   * `registry-mismatch` that fails this registry closed.
   */
  readonly registryId: string;
  /** Absolute `GET /v1/revocation/feed` URL for this registry (registry SPEC §6). */
  readonly feedUrl: string;
  /** Optional abort signal, so a slow poll can be cancelled on teardown. */
  readonly signal?: AbortSignal;
}

/**
 * Why a registry's feed check reached its verdict. The three `evaluateFreshness`
 * fail-closed codes (`stale` / `rolled-back` / `registry-mismatch`) plus this
 * module's own transport/verification failures — every non-`fresh` value fails the
 * registry closed.
 *
 * - `fresh`       — feed within TTL, not rolled back: this registry's remotes may
 *                   load, minus any artifact in {@link RegistryRevocationVerdict.blocked}.
 * - `stale`       — past `issuedAt + ttlSeconds`: fail closed for this registry.
 * - `rolled-back` — replayed older feed (`seq` below the cursor): fail closed.
 * - `registry-mismatch` — served feed names a different registry: fail closed.
 * - `unreachable` — the feed could not be fetched (transport error / non-2xx).
 * - `malformed`   — the response was not a well-formed signed-feed document.
 * - `unverified`  — the detached signature did not verify (or the verifier threw).
 */
export type RegistryFeedStatus =
  | FreshnessVerdictCode
  | 'unreachable'
  | 'malformed'
  | 'unverified';

/**
 * The per-registry load decision {@link ../boot/revocation-gate} applies to the
 * resolved remotes. When `failClosed` is `true`, **every** remote from this
 * registry is refused (scoped fail-closed — other registries are unaffected);
 * otherwise the registry's remotes may load except the artifacts named in
 * {@link blocked} (its revoked/killed entries).
 */
export interface RegistryRevocationVerdict {
  /** The registry this verdict governs. */
  readonly registryId: string;
  /** Machine-readable outcome (see {@link RegistryFeedStatus}). */
  readonly status: RegistryFeedStatus;
  /**
   * `true` iff this registry's remotes must all be refused (any non-`fresh`
   * status). The block is scoped to this registry only.
   */
  readonly failClosed: boolean;
  /**
   * Individually revoked/killed artifacts, populated only when `status` is
   * `fresh` (when the whole registry fails closed the per-artifact list is moot).
   * Each carries its `state` so a `killed` one is additionally force-unmounted.
   */
  readonly blocked: readonly BlockedArtifact[];
}

/**
 * The per-registry revocation & kill-feed client. For each trusted registry it
 * fetches the signed feed, verifies its signature, and runs the protocol freshness
 * gate against that registry's cursor — returning a {@link RegistryRevocationVerdict}
 * and advancing the cursor on a fresh feed. It **never throws** for a feed problem:
 * a transport, shape, verification, staleness, or rollback failure becomes a
 * fail-closed verdict for that registry alone, so the fail-closed rule stays scoped
 * (SPEC §2) and one bad feed cannot abort the boot.
 */
export class RevocationFeedClient {
  readonly #verifier: FeedSignatureVerifier;
  readonly #cursors: CursorStore;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(options: RevocationFeedClientOptions) {
    this.#verifier = options.verifier;
    this.#cursors = options.cursors ?? new InMemoryCursorStore();
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Check one registry's feed and decide whether its remotes may load. Fetches the
   * feed, verifies the signature, then runs `evaluateFreshness` against the stored
   * cursor. On a fresh feed the cursor advances to the feed's `seq` and the
   * revoked/killed entries are returned as `blocked`; any failure (transport, shape,
   * signature, staleness, rollback, registry mismatch) returns a `failClosed`
   * verdict for this registry only.
   */
  async checkRegistry(endpoint: RegistryFeedEndpoint): Promise<RegistryRevocationVerdict> {
    const signed = await this.#fetchSignedFeed(endpoint);
    if (signed === undefined) {
      return failClosed(endpoint.registryId, 'unreachable');
    }
    if (!isSignedRevocationFeed(signed)) {
      return failClosed(endpoint.registryId, 'malformed');
    }
    if (!(await this.#verify(signed))) {
      return failClosed(endpoint.registryId, 'unverified');
    }

    const cursor = this.#cursors.get(endpoint.registryId);
    const verdict = evaluateFreshness(signed.feed, cursor, this.#now());
    if (!verdict.ok) {
      return failClosed(endpoint.registryId, verdict.code);
    }

    // A fresh feed is accepted: advance the cursor so a later replayed feed at a
    // lower seq is caught as a rollback.
    this.#cursors.set({ registryId: endpoint.registryId, seq: verdict.nextSeq! });
    return {
      registryId: endpoint.registryId,
      status: 'fresh',
      failClosed: false,
      blocked: verdict.blocked,
    };
  }

  /**
   * Check every trusted registry's feed independently and key the verdicts by
   * registry id. The checks run concurrently and never share a failure — the
   * fail-closed scoping (SPEC §2) is exactly this independence — so a stale or
   * unreachable registry yields its own fail-closed verdict while the rest resolve
   * normally.
   */
  async checkAll(
    endpoints: readonly RegistryFeedEndpoint[],
  ): Promise<Map<string, RegistryRevocationVerdict>> {
    const verdicts = await Promise.all(
      endpoints.map((endpoint) => this.checkRegistry(endpoint)),
    );
    return new Map(verdicts.map((verdict) => [verdict.registryId, verdict]));
  }

  /** GET the signed feed; a transport error or non-2xx resolves to `undefined` (→ unreachable). */
  async #fetchSignedFeed(endpoint: RegistryFeedEndpoint): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(endpoint.feedUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        ...(endpoint.signal !== undefined ? { signal: endpoint.signal } : {}),
      });
    } catch {
      return undefined;
    }
    if (!response.ok) {
      return undefined;
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    }
  }

  /** Run the injected verifier, treating a thrown/rejected verifier as "did not verify". */
  async #verify(signed: SignedRevocationFeed): Promise<boolean> {
    try {
      return await this.#verifier(signed);
    } catch {
      return false;
    }
  }
}

/** Build a fail-closed verdict (no per-artifact list — the whole registry is refused). */
function failClosed(registryId: string, status: RegistryFeedStatus): RegistryRevocationVerdict {
  return { registryId, status, failClosed: true, blocked: [] };
}

/**
 * Structural check that a body is a signed-feed document. Shape only — the feed's
 * contents stay untrusted input to the signature verifier and `evaluateFreshness`;
 * this just refuses a body those steps could not consume. Entries are checked
 * shallowly (each has the string/enum fields the feed relies on) so a structurally
 * broken entry is a `malformed` fail-closed rather than a later throw.
 */
function isSignedRevocationFeed(value: unknown): value is SignedRevocationFeed {
  if (!isRecord(value) || !isRecord(value.feed) || !isRecord(value.signature)) {
    return false;
  }
  const { feed, signature } = value;
  if (
    typeof signature.alg !== 'string' ||
    typeof signature.cert !== 'string' ||
    typeof signature.sig !== 'string'
  ) {
    return false;
  }
  if (
    typeof feed.formatVersion !== 'string' ||
    typeof feed.registryId !== 'string' ||
    typeof feed.seq !== 'number' ||
    typeof feed.issuedAt !== 'number' ||
    typeof feed.ttlSeconds !== 'number' ||
    !Array.isArray(feed.entries)
  ) {
    return false;
  }
  return feed.entries.every(isRevocationEntry);
}

function isRevocationEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.artifact === 'string' &&
    (value.state === 'revoked' || value.state === 'killed') &&
    typeof value.severity === 'string' &&
    typeof value.reason === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
