/**
 * **Buffer-verify** — the per-fetch byte check at the heart of the SW's
 * buffer-verify-serve (docs/SPEC.md §2; FR-11), split out of the SW script so it is
 * unit-tested under Node (Vitest env is node-only, no SW globals).
 *
 * The SW, for a URL a verified release claims, fully buffers the response and calls
 * {@link verifyBytes} with the exact bytes and the release's `expected` hash. Hash
 * verification cannot stream-then-revoke, so the SW must have the *whole* artifact in
 * hand before it decides — this function is that decision, and it is total: it maps
 * every hash outcome to a verdict rather than throwing.
 *
 * The actual hashing is `@gridmason/protocol`'s {@link verifyHash} — the isomorphic,
 * 100%-covered content-hash core (WebCrypto `crypto.subtle`, no `node:crypto`), which
 * works identically in the SW and in a Node test. This module interprets none of the
 * crypto; it only adapts `verifyHash`'s reason enum to the SW's refusal reasons and
 * fails closed on anything that is not an exact match.
 *
 * Pure and isomorphic: bytes in, verdict out. No I/O, no `Response`, no SW globals —
 * the SW builds the actual `Response.error()` / served response around this verdict.
 */
import {
  verifyHash,
  type HashVerdictReason,
  type MultihashString,
} from '@gridmason/protocol/verify';

/**
 * Why the SW refused to serve buffered bytes:
 * - `unclaimed-url` — no release claims this URL (decided by the enforcement table,
 *   before any fetch; carried here so the SW has one refusal vocabulary);
 * - `hash-mismatch` — a well-formed hash, but the served bytes differ (tampered chunk);
 * - `unknown-hash-prefix` — a recognizable `<algo>:` tag the verify core does not
 *   implement; refused, never guessed;
 * - `malformed-hash` — the expected string is not a valid `<algo>:<hex>` at all.
 */
export type FetchRefusalReason =
  | 'unclaimed-url'
  | 'hash-mismatch'
  | 'unknown-hash-prefix'
  | 'malformed-hash';

/** The verdict for one buffered artifact: serve (`ok`) or refuse with a stable reason. */
export type FetchVerdict =
  | { readonly ok: true; readonly computed: MultihashString }
  | { readonly ok: false; readonly reason: FetchRefusalReason };

/** Adapt `@gridmason/protocol`'s hash-verdict reason to the SW's refusal vocabulary. */
function mapReason(reason: HashVerdictReason): FetchRefusalReason {
  switch (reason) {
    case 'hash-mismatch':
      return 'hash-mismatch';
    case 'unknown-hash-prefix':
      return 'unknown-hash-prefix';
    case 'malformed-hash-string':
      return 'malformed-hash';
    case 'ok':
      // Unreachable: `verifyBytes` returns `ok` before mapping. Fail closed if the
      // core's contract ever changes rather than silently serving.
      return 'hash-mismatch';
  }
}

/**
 * Verify buffered artifact bytes against the hash a verified release listed for their
 * URL. Returns `{ ok: true }` only on an exact match; every other outcome — mismatch,
 * unknown prefix, malformed expected string — is a refusal with a stable reason (the
 * SW turns a refusal into a `Response.error()`, i.e. a network error to the importer).
 * Never throws.
 */
export async function verifyBytes(
  bytes: Uint8Array,
  expected: MultihashString,
): Promise<FetchVerdict> {
  const verdict = await verifyHash(bytes, expected);
  if (verdict.ok) return { ok: true, computed: verdict.computed };
  return { ok: false, reason: mapReason(verdict.reason) };
}
