import { describe, expect, it, vi } from 'vitest';
import type { RevocationEntry } from '@gridmason/protocol';
import {
  InMemoryCursorStore,
  protocolFeedVerifier,
  RevocationFeedClient,
  type FeedSignatureVerifier,
  type RegistryFeedEndpoint,
  type SignedRevocationFeed,
} from './revocation-feed';

const REGISTRY = 'registry.gridmason.dev';
const FEED_URL = 'https://registry.gridmason.dev/v1/revocation/feed';
const NOW = 1_720_000_000_000;

function endpoint(overrides: Partial<RegistryFeedEndpoint> = {}): RegistryFeedEndpoint {
  return { registryId: REGISTRY, feedUrl: FEED_URL, ...overrides };
}

function signedFeed(overrides: Partial<SignedRevocationFeed['feed']> = {}): SignedRevocationFeed {
  return {
    feed: {
      formatVersion: '1.0',
      registryId: REGISTRY,
      seq: 3,
      issuedAt: NOW,
      ttlSeconds: 3600,
      entries: [],
      ...overrides,
    },
    signature: { alg: 'ES256', cert: 'BASE64CERT', sig: 'BASE64SIG' },
  };
}

function entry(overrides: Partial<RevocationEntry> = {}): RevocationEntry {
  return {
    artifact: 'acme-chart@2.3.1',
    state: 'killed',
    severity: 'critical',
    reason: 'actively exploited',
    ...overrides,
  };
}

/** A `fetch` returning a JSON body once, recording its calls. */
function jsonFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const YES: FeedSignatureVerifier = () => true;
const NO: FeedSignatureVerifier = () => false;

describe('RevocationFeedClient.checkRegistry (SPEC §2, FR-12, registry SPEC §6)', () => {
  it('accepts a fresh signed feed and reports its revoked/killed artifacts as blocked', async () => {
    const { fetchImpl } = jsonFetch(signedFeed({ entries: [entry()] }));
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, now: () => NOW });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('fresh');
    expect(verdict.failClosed).toBe(false);
    expect(verdict.blocked).toEqual([
      { artifact: 'acme-chart@2.3.1', state: 'killed', severity: 'critical' },
    ]);
  });

  it('GETs the feed url with a JSON accept header', async () => {
    const { fetchImpl, calls } = jsonFetch(signedFeed());
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, now: () => NOW });

    await client.checkRegistry(endpoint());

    expect(calls).toEqual([FEED_URL]);
  });

  it('advances the per-registry cursor when a feed is accepted', async () => {
    const cursors = new InMemoryCursorStore();
    const { fetchImpl } = jsonFetch(signedFeed({ seq: 7 }));
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, cursors, now: () => NOW });

    await client.checkRegistry(endpoint());

    expect(cursors.get(REGISTRY).seq).toBe(7);
  });

  it('rejects a replayed older feed as a rollback, fail-closed, without advancing the cursor', async () => {
    const cursors = new InMemoryCursorStore();
    cursors.set({ registryId: REGISTRY, seq: 9 });
    const { fetchImpl } = jsonFetch(signedFeed({ seq: 4 }));
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, cursors, now: () => NOW });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('rolled-back');
    expect(verdict.failClosed).toBe(true);
    expect(cursors.get(REGISTRY).seq).toBe(9);
  });

  it('fails a feed closed once it is past its TTL (stale)', async () => {
    const { fetchImpl } = jsonFetch(signedFeed({ issuedAt: NOW, ttlSeconds: 3600 }));
    // One ms past issuedAt + ttl.
    const client = new RevocationFeedClient({
      verifier: YES,
      fetchImpl,
      now: () => NOW + 3600 * 1000 + 1,
    });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('stale');
    expect(verdict.failClosed).toBe(true);
    expect(verdict.blocked).toEqual([]);
  });

  it('fails closed when the served feed names a different registry (registry-mismatch)', async () => {
    const { fetchImpl } = jsonFetch(signedFeed({ registryId: 'evil.example' }));
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, now: () => NOW });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('registry-mismatch');
    expect(verdict.failClosed).toBe(true);
  });

  it('fails closed (unverified) when the signature does not verify, before touching freshness', async () => {
    const { fetchImpl } = jsonFetch(signedFeed({ entries: [entry()] }));
    const client = new RevocationFeedClient({ verifier: NO, fetchImpl, now: () => NOW });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('unverified');
    expect(verdict.failClosed).toBe(true);
    expect(verdict.blocked).toEqual([]);
  });

  it('treats a verifier that throws as unverified (never propagates)', async () => {
    const throwing: FeedSignatureVerifier = () => {
      throw new Error('boom');
    };
    const { fetchImpl } = jsonFetch(signedFeed());
    const client = new RevocationFeedClient({ verifier: throwing, fetchImpl, now: () => NOW });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('unverified');
    expect(verdict.failClosed).toBe(true);
  });

  it('fails closed (unreachable) on a transport error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, now: () => NOW });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('unreachable');
    expect(verdict.failClosed).toBe(true);
  });

  it('fails closed (unreachable) on a non-2xx response', async () => {
    const { fetchImpl } = jsonFetch(undefined, { ok: false, status: 503 });
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, now: () => NOW });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('unreachable');
  });

  it('fails closed (malformed) when the body is not a signed-feed document', async () => {
    const { fetchImpl } = jsonFetch({ feed: { registryId: REGISTRY }, signature: {} });
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, now: () => NOW });

    const verdict = await client.checkRegistry(endpoint());

    expect(verdict.status).toBe('malformed');
    expect(verdict.failClosed).toBe(true);
  });

  it('fails closed (malformed) when an entry is structurally broken', async () => {
    const bad = signedFeed({
      entries: [{ artifact: 'x', state: 'nope' } as unknown as RevocationEntry],
    });
    const { fetchImpl } = jsonFetch(bad);
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, now: () => NOW });

    expect((await client.checkRegistry(endpoint())).status).toBe('malformed');
  });
});

describe('protocolFeedVerifier — default backing over @gridmason/protocol@0.4.0 verifyRevocationFeed', () => {
  // The real primitive drives these — no injected seam. A properly authenticated
  // feed needs a leaf cert issued by a pinned countersign root (proven at 100%
  // coverage in the protocol package); here we assert the security-critical
  // direction end to end: with no matching root the detached signature cannot be
  // authenticated, so the deployment fails closed.
  it('fails closed (false) when no countersign roots are pinned', async () => {
    const verify = protocolFeedVerifier([]);
    await expect(verify(signedFeed({ entries: [entry()] }))).resolves.toBe(false);
  });

  it('fails closed (false) when the feed signature is not issued by a pinned root', async () => {
    const verify = protocolFeedVerifier([new Uint8Array([1, 2, 3])]);
    await expect(verify(signedFeed())).resolves.toBe(false);
  });

  it('resolves a boolean rather than throwing on an unauthenticated feed (stable-reason contract)', async () => {
    const verify = protocolFeedVerifier([]);
    const result = verify(signedFeed());
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe(false);
  });
});

describe('RevocationFeedClient.checkAll — independent per-registry scoping', () => {
  it('yields one verdict per registry, keyed by id, without a shared failure', async () => {
    const other = 'registry.other.dev';
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      // The first registry is unreachable; the second is fresh.
      if (String(url).includes('other')) {
        return { ok: true, status: 200, json: async () => signedFeed({ registryId: other }) } as Response;
      }
      throw new Error('down');
    }) as unknown as typeof fetch;
    const client = new RevocationFeedClient({ verifier: YES, fetchImpl, now: () => NOW });

    const verdicts = await client.checkAll([
      endpoint(),
      endpoint({ registryId: other, feedUrl: 'https://registry.other.dev/v1/revocation/feed' }),
    ]);

    expect(verdicts.get(REGISTRY)?.status).toBe('unreachable');
    expect(verdicts.get(REGISTRY)?.failClosed).toBe(true);
    expect(verdicts.get(other)?.status).toBe('fresh');
    expect(verdicts.get(other)?.failClosed).toBe(false);
  });

  // Regression (#82): browsers enforce fetch's receiver (WebIDL "Illegal invocation"),
  // so the default fetch must be bound to globalThis. Node's fetch doesn't enforce a
  // receiver, so this stub does — the old unbound default turns every feed check into
  // a silent fail-closed `unreachable` in every real browser.
  it('default fetch survives a receiver-enforcing global fetch (browser semantics)', async () => {
    const realFetch = globalThis.fetch;
    function enforcing(this: unknown, ..._args: Parameters<typeof fetch>): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => signedFeed(),
      } as Response);
    }
    globalThis.fetch = enforcing as typeof fetch;
    try {
      const client = new RevocationFeedClient({ verifier: YES, now: () => NOW });
      const verdict = await client.checkRegistry(endpoint());
      expect(verdict.status).toBe('fresh');
      expect(verdict.failClosed).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
