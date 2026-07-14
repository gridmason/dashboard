import { describe, expect, it } from 'vitest';
import { isSha256Pin, matchesPin, sha256Pin } from './hash';

/**
 * The acknowledged-sideload content pin (SPEC §4, FR-8): an SRI `sha256-<base64>`
 * hash of a remote's entry bytes, the gate the load path checks before mounting.
 */
describe('sha256Pin', () => {
  it('produces the known SRI sha256 of the empty input', async () => {
    // The SRI sha256 of zero bytes is a fixed, well-known vector.
    expect(await sha256Pin(new Uint8Array(0))).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });

  it('is deterministic and content-sensitive', async () => {
    const a = new TextEncoder().encode('export default 1;');
    const b = new TextEncoder().encode('export default 2;');
    expect(await sha256Pin(a)).toBe(await sha256Pin(a));
    expect(await sha256Pin(a)).not.toBe(await sha256Pin(b));
    expect(isSha256Pin(await sha256Pin(a))).toBe(true);
  });
});

describe('matchesPin', () => {
  it('accepts content that hashes to its pin and rejects tampered content', async () => {
    const content = new TextEncoder().encode('export default 1;');
    const pin = await sha256Pin(content);
    expect(await matchesPin(content, pin)).toBe(true);
    expect(await matchesPin(new TextEncoder().encode('tampered'), pin)).toBe(false);
  });

  it('rejects a malformed pin without throwing', async () => {
    expect(await matchesPin(new Uint8Array(0), 'not-a-pin')).toBe(false);
  });
});

describe('isSha256Pin', () => {
  it('recognizes SRI sha256 pins and rejects other shapes', () => {
    expect(isSha256Pin('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')).toBe(true);
    expect(isSha256Pin('deadbeef')).toBe(false);
    expect(isSha256Pin('sha512-abc')).toBe(false);
  });
});
