import { describe, expect, it } from 'vitest';
import { hashBytes, type MultihashString } from '@gridmason/protocol/verify';
import { verifyBytes } from './verify-fetch';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('verifyBytes (SPEC §2; FR-11 buffer-verify)', () => {
  it('serves bytes whose hash matches the release-listed hash', async () => {
    const artifact = bytes('export const x = 1;');
    const expected = await hashBytes(artifact);
    const verdict = await verifyBytes(artifact, expected);
    expect(verdict).toEqual({ ok: true, computed: expected });
  });

  it('refuses tampered bytes with hash-mismatch (a mutated artifact)', async () => {
    // The release listed the hash of the real artifact; the SW buffered mutated bytes.
    const expected = await hashBytes(bytes('export const x = 1;'));
    const verdict = await verifyBytes(bytes('export const x = 1; /* evil */'), expected);
    expect(verdict).toEqual({ ok: false, reason: 'hash-mismatch' });
  });

  it('refuses an unimplemented but recognizable hash algorithm rather than guessing', async () => {
    const verdict = await verifyBytes(bytes('anything'), 'sha3-256:deadbeef' as MultihashString);
    expect(verdict).toEqual({ ok: false, reason: 'unknown-hash-prefix' });
  });

  it('refuses a malformed expected hash string', async () => {
    const verdict = await verifyBytes(bytes('anything'), 'not-a-hash' as MultihashString);
    expect(verdict).toEqual({ ok: false, reason: 'malformed-hash' });
  });
});
