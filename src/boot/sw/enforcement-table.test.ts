import { describe, expect, it } from 'vitest';
import type { MultihashString } from '@gridmason/protocol/verify';
import {
  ENFORCEMENT_ACK_TYPE,
  ENFORCEMENT_MESSAGE_TYPE,
  EnforcementTable,
  enforcementTableFrom,
  isEnforcementMessage,
  tableFromMessage,
  type EnforcementEntry,
} from './enforcement-table';

const HASH_A = 'sha2-256:aaa' as MultihashString;
const HASH_B = 'sha2-256:bbb' as MultihashString;
const CDN = 'https://cdn.gridmason.dev';
const URL_A = `${CDN}/v1/artifacts/sha2-256:aaa`;
const URL_B = `${CDN}/v1/artifacts/sha2-256:bbb`;

function table(entries: EnforcementEntry[]): EnforcementTable {
  return new EnforcementTable(entries);
}

describe('EnforcementTable.classify (SPEC §2; FR-11)', () => {
  it('verifies a claimed URL against its exact expected hash', () => {
    const decision = table([[URL_A, HASH_A]]).classify(URL_A);
    expect(decision).toEqual({ kind: 'verify', expected: HASH_A });
  });

  it('refuses an unclaimed URL on a guarded origin (per-URL, not per-origin trust)', () => {
    // URL_A is claimed, so cdn.gridmason.dev is guarded territory; a *different*
    // path on the same CDN is claimed by no release → refused outright (SPEC §2).
    const decision = table([[URL_A, HASH_A]]).classify(`${CDN}/v1/artifacts/sha2-256:evil`);
    expect(decision).toEqual({ kind: 'refuse' });
  });

  it('passes through a URL on an origin the table does not guard', () => {
    // The shell's own asset / API — no claimed URL on this origin, so not the SW's concern.
    const decision = table([[URL_A, HASH_A]]).classify('https://app.example.com/assets/main.js');
    expect(decision).toEqual({ kind: 'passthrough' });
  });

  it('does not cross-contaminate two registries sharing one CDN host', () => {
    // Both registries publish to the same object store; each claims only its own URL.
    const shared = table([
      [URL_A, HASH_A],
      [URL_B, HASH_B],
    ]);
    expect(shared.classify(URL_A)).toEqual({ kind: 'verify', expected: HASH_A });
    expect(shared.classify(URL_B)).toEqual({ kind: 'verify', expected: HASH_B });
    // A path neither release claims, on the shared host, is refused — one registry
    // cannot serve bytes under a URL the other (or nobody) owns.
    expect(shared.classify(`${CDN}/v1/artifacts/sha2-256:unlisted`)).toEqual({ kind: 'refuse' });
  });

  it('classifies against a normalized URL so trivial spelling differences still match', () => {
    // A default port / redundant form resolves to the same href the table stored.
    const t = table([['https://cdn.gridmason.dev:443/v1/artifacts/sha2-256:aaa', HASH_A]]);
    expect(t.classify(URL_A)).toEqual({ kind: 'verify', expected: HASH_A });
  });

  it('an empty table guards nothing — every request passes through (showcase no-op)', () => {
    const empty = table([]);
    expect(empty.size).toBe(0);
    expect(empty.classify(URL_A)).toEqual({ kind: 'passthrough' });
  });
});

describe('enforcement message round-trip', () => {
  it('serializes a boot url→hash map and rebuilds an equivalent table', () => {
    const urlHashes = new Map<string, MultihashString>([
      [URL_A, HASH_A],
      [URL_B, HASH_B],
    ]);
    const message = enforcementTableFrom(urlHashes).toMessage();
    expect(message.type).toBe(ENFORCEMENT_MESSAGE_TYPE);

    const rebuilt = tableFromMessage(message);
    expect(rebuilt.classify(URL_A)).toEqual({ kind: 'verify', expected: HASH_A });
    expect(rebuilt.classify(URL_B)).toEqual({ kind: 'verify', expected: HASH_B });
  });

  it('accepts a well-formed install message and rejects malformed data (SW trusts no shape blindly)', () => {
    const good = enforcementTableFrom(new Map([[URL_A, HASH_A]])).toMessage();
    expect(isEnforcementMessage(good)).toBe(true);

    expect(isEnforcementMessage(null)).toBe(false);
    expect(isEnforcementMessage({ type: 'other', entries: [] })).toBe(false);
    expect(isEnforcementMessage({ type: ENFORCEMENT_MESSAGE_TYPE })).toBe(false);
    expect(isEnforcementMessage({ type: ENFORCEMENT_MESSAGE_TYPE, entries: [['only-one']] })).toBe(false);
    expect(isEnforcementMessage({ type: ENFORCEMENT_ACK_TYPE, size: 1 })).toBe(false);
  });
});
