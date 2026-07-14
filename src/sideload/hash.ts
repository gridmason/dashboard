/**
 * Content-hash pinning for acknowledged sideload (docs/SPEC.md §4, FR-8) — the
 * **prod-safe** hash primitive the acknowledged load path pins a remote's entry
 * module to.
 *
 * The pin format is **SRI `sha256-<base64>`** (the Subresource-Integrity spelling):
 * a browser-native, standards-aligned content hash, computed with Web Crypto
 * (`crypto.subtle`), isomorphic across the browser and Node test env. `@gridmason/
 * protocol`'s verification library will own the canonical remote content-hash
 * format, but that library is still a placeholder (P-E3) — this module deliberately
 * mirrors the SRI shape so the two converge rather than fork, and there is a single
 * `TODO` seam to swap to the protocol helper once it ships.
 *
 * Pure and side-effect-free: it hashes bytes, it does no fetching. The load path
 * (`./acknowledged-remotes`) fetches the entry, hashes it here, and refuses the
 * mount on a mismatch. **Phase-A honesty note (FR-8): there is no verification
 * *chain* yet** — this pins content to a hash the owner recorded, not to a signed,
 * logged release. Run only widgets you built or reviewed.
 */

/** The SRI algorithm prefix this module pins with. */
const SRI_ALGORITHM = 'sha256';

/** Whether `value` is a well-formed SRI `sha256-<base64>` pin. */
export function isSha256Pin(value: string): boolean {
  return /^sha256-[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Base64-encode raw bytes (isomorphic: `btoa` exists in the browser and modern Node). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Normalize to a definite `ArrayBuffer` (the `BufferSource` `digest` requires). */
function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Compute the SRI `sha256-<base64>` content hash of `bytes`. The input is the raw
 * response body of a remote's entry module (as an `ArrayBuffer`/`Uint8Array`), so
 * the pin is over the exact transferred bytes, independent of text decoding.
 */
export async function sha256Pin(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // TODO(P-E3): swap to `@gridmason/protocol`'s content-hash helper once its
  // verification library ships, if it standardizes on this same SRI spelling.
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return `${SRI_ALGORITHM}-${bytesToBase64(new Uint8Array(digest))}`;
}

/**
 * Whether `bytes` hash to the pinned `expected` SRI hash. A constant-shape
 * comparison of the recomputed pin against the stored one — the gate the
 * acknowledged load path calls before it mounts a remote (a mismatch refuses the
 * load, SPEC §4). Returns `false` for a malformed `expected` rather than throwing.
 */
export async function matchesPin(bytes: ArrayBuffer | Uint8Array, expected: string): Promise<boolean> {
  if (!isSha256Pin(expected)) return false;
  const actual = await sha256Pin(bytes);
  return actual === expected;
}
