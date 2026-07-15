import { describe, expect, it, vi } from 'vitest';

// The default backing is a thin adapter over the protocol primitive, so the two
// things worth pinning — that it forwards the *exact* pinned countersign roots as
// the trust input, and that it returns the verdict's `ok` gate faithfully in both
// directions — are asserted against a stubbed `verifyRevocationFeed`. The real
// primitive's own behavior is proven in `@gridmason/protocol` (100% coverage) and
// exercised end-to-end in revocation-feed.test.ts + federated-boot.test.ts.
const { verifyRevocationFeed } = vi.hoisted(() => ({ verifyRevocationFeed: vi.fn() }));
vi.mock('@gridmason/protocol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gridmason/protocol')>();
  return { ...actual, verifyRevocationFeed };
});

import { protocolFeedVerifier, type SignedRevocationFeed } from './revocation-feed';

const REGISTRY = 'registry.gridmason.dev';

function signed(): SignedRevocationFeed {
  return {
    feed: {
      formatVersion: '1.0',
      registryId: REGISTRY,
      seq: 1,
      issuedAt: 1_000,
      ttlSeconds: 3600,
      entries: [],
    },
    signature: { alg: 'ES256', cert: 'BASE64CERT', sig: 'BASE64SIG' },
  };
}

describe('protocolFeedVerifier forwards the pinned roots and maps the verdict', () => {
  it('passes the served feed + exact countersign roots to verifyRevocationFeed', async () => {
    verifyRevocationFeed.mockResolvedValue({ ok: true, reason: 'ok' });
    const roots = [new Uint8Array([9, 8, 7])];
    const feed = signed();

    await protocolFeedVerifier(roots)(feed);

    expect(verifyRevocationFeed).toHaveBeenCalledWith(feed, { countersignRoots: roots });
  });

  it('returns true when the primitive authenticates the feed (ok)', async () => {
    verifyRevocationFeed.mockResolvedValue({ ok: true, reason: 'ok' });
    await expect(protocolFeedVerifier([new Uint8Array([1])])(signed())).resolves.toBe(true);
  });

  it('returns false for every non-ok verdict (fail closed)', async () => {
    verifyRevocationFeed.mockResolvedValue({ ok: false, reason: 'signature-invalid' });
    await expect(protocolFeedVerifier([new Uint8Array([1])])(signed())).resolves.toBe(false);
  });
});
