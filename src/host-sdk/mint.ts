/**
 * Per-instance identity minting (docs/SPEC.md §2, §3, FR-14). At mount the shell
 * mints two distinct values for a widget instance:
 *
 * - a public **instance id** (`identity.instanceId`) — non-secret, distinct per
 *   mount, the value the API attributes a stamped call to (SPEC §3 rules 3, 5);
 * - an unforgeable **instance token** — the closure-held secret the SDK transport
 *   stamps under `INSTANCE_TOKEN_HEADER` and the API maps to
 *   `(instanceId, widgetId, declared capabilities)` (SPEC §2). It is minted here
 *   (the shell), branded through the SDK's `toInstanceToken` (a type-level cast,
 *   not minting), and **never** exposed to widget code — it lives only in the
 *   transport closure (`reference-host.ts`).
 *
 * "The shell mints" (per `@gridmason/sdk`'s `docs/identity-token.md`): the SDK
 * ships no minting or crypto; this module is where the dashboard produces the
 * secret. It uses `crypto.getRandomValues` so the token is unguessable, falling
 * back for non-crypto test environments.
 */

import { toInstanceToken, type InstanceToken } from '@gridmason/sdk';

/** Monotonic suffix so two mints in the same millisecond still read distinctly in a log. */
let mintCounter = 0;

/** 128 bits of randomness rendered as hex, or a non-crypto fallback for bare test runs. */
function randomHex(bytes: number): string {
  const g: typeof globalThis & { crypto?: Crypto } = globalThis;
  if (typeof g.crypto?.getRandomValues === 'function') {
    const buf = g.crypto.getRandomValues(new Uint8Array(bytes));
    let hex = '';
    for (const b of buf) hex += b.toString(16).padStart(2, '0');
    return hex;
  }
  let hex = '';
  while (hex.length < bytes * 2) hex += Math.random().toString(16).slice(2);
  return hex.slice(0, bytes * 2);
}

/**
 * Mint an unguessable per-mount **instance id** (public — `identity.instanceId`).
 * Distinct and non-sequential so two mounts of one widget never collide and an id
 * cannot be guessed from another; `crypto.randomUUID` where available.
 */
export function mintInstanceId(): string {
  const seq = (mintCounter = (mintCounter + 1) & 0xffff).toString(16).padStart(4, '0');
  const g: typeof globalThis & { crypto?: Crypto } = globalThis;
  if (typeof g.crypto?.randomUUID === 'function') {
    return `inst-${g.crypto.randomUUID()}-${seq}`;
  }
  return `inst-${randomHex(16)}-${seq}`;
}

/**
 * Mint the unforgeable per-instance **token** — 256 bits of randomness the API
 * cannot forge and a widget cannot guess. Branded via the SDK's
 * {@link toInstanceToken} (a type cast that adds no entropy — the entropy is
 * here). The caller holds it inside the transport closure and never exposes it.
 */
export function mintInstanceToken(): InstanceToken {
  return toInstanceToken(`itk_${randomHex(32)}`);
}
