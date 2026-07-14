/**
 * The reference governance adapter over the real demo API (FR-4, SPEC §5/§6).
 * Each case boots the demo service on an ephemeral port and drives the adapter
 * over HTTP, asserting the org publication (`{ layout, locks }`) round-trips
 * through the governance KV, that publishing is refused for a non-publisher
 * (`403` surfaced as a {@link GovernanceError}), and that reading an absent
 * publication resolves to `undefined`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ScopeKey } from '@gridmason/core/engine';
import {
  loginCookie,
  makeLayoutDoc,
  startTestServer,
  type TestServer,
} from '../../../server/api/test-helpers';
import { ApiGovernance, GovernanceError, type OrgPublication } from './api-governance';

/** A `fetch` that attaches a stub-login cookie the browser would send automatically. */
function fetchWithCookie(cookie: string): typeof globalThis.fetch {
  return (input, init = {}) =>
    globalThis.fetch(input, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), cookie },
    });
}

async function adapterAs(
  server: TestServer,
  username: string,
  password: string,
): Promise<ApiGovernance> {
  const cookie = await loginCookie(server.baseUrl, username, password);
  return new ApiGovernance({ userId: username, baseUrl: server.baseUrl, fetch: fetchWithCookie(cookie) });
}

/** The org-scope key the governance demo publishes under. */
const ORG_KEY: ScopeKey = { owner: { node: 'org' }, pageType: 'demo.record-detail', entityId: 'gov-demo' };

function makePublication(): OrgPublication {
  return { layout: makeLayoutDoc({ name: 'Org standard', default: false }), locks: ['header', 'metrics'] };
}

describe('ApiGovernance', () => {
  let server: TestServer;
  afterEach(async () => {
    await server?.close();
  });

  it('publishes an org layout+locks to the org node and reads it back identical', async () => {
    server = await startTestServer();
    const admin = await adapterAs(server, 'alice', 'alice-dev-password');
    const publication = makePublication();

    await admin.publish(ORG_KEY, publication);

    // Verified against the governance KV: the adapter landed it at the `org` node.
    expect(server.governance.get({ scope: 'org', pageType: 'demo.record-detail', entityId: 'gov-demo' })).toEqual(
      publication,
    );
    expect(await admin.get(ORG_KEY)).toEqual(publication);
  });

  it('lets any authenticated user read the publication that governs them', async () => {
    server = await startTestServer();
    const admin = await adapterAs(server, 'alice', 'alice-dev-password');
    await admin.publish(ORG_KEY, makePublication());

    const member = await adapterAs(server, 'bob', 'bob-dev-password');
    expect(await member.get(ORG_KEY)).toEqual(makePublication());
  });

  it('refuses publishing for a non-publisher role, surfacing the 403', async () => {
    server = await startTestServer();
    const member = await adapterAs(server, 'bob', 'bob-dev-password');

    await expect(member.publish(ORG_KEY, makePublication())).rejects.toMatchObject({
      name: 'GovernanceError',
      status: 403,
    });
    expect(member.publish(ORG_KEY, makePublication())).rejects.toBeInstanceOf(GovernanceError);
    expect(server.governance.size).toBe(0);
  });

  it('resolves a missing publication to undefined', async () => {
    server = await startTestServer();
    const admin = await adapterAs(server, 'alice', 'alice-dev-password');
    expect(await admin.get({ owner: { node: 'org' }, pageType: 'never.published' })).toBeUndefined();
  });

  it('unpublishes and reports whether a publication was present', async () => {
    server = await startTestServer();
    const admin = await adapterAs(server, 'alice', 'alice-dev-password');
    await admin.publish(ORG_KEY, makePublication());

    expect(await admin.unpublish(ORG_KEY)).toBe(true);
    expect(await admin.get(ORG_KEY)).toBeUndefined();
    // Un-publishing an absent publication is an idempotent `false`.
    expect(await admin.unpublish(ORG_KEY)).toBe(false);
  });
});
