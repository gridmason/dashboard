/**
 * The static-demo session bootstrap (GW-D21, SPEC §1). It signs in as the fixed
 * baked `currentUser` with no network, so the serverless build has a concrete
 * `user:<id>` scope and a role for the publisher gate.
 */
import { describe, expect, it } from 'vitest';
import { ensureStaticSession, staticDemoConfig, staticDemoUser } from './static-session';

describe('static demo session', () => {
  it('resolves the baked currentUser as the session user', async () => {
    const user = await ensureStaticSession();
    const config = staticDemoConfig();
    expect(user.id).toBe(config.currentUser);
    expect(user).toEqual(staticDemoUser());
  });

  it('signs the demo in as a user that actually exists in the baked user list', () => {
    const config = staticDemoConfig();
    expect(config.users.map((u) => u.id)).toContain(config.currentUser);
  });

  it('gives the current demo user the publisher role so the governance demo is exercisable', async () => {
    // The demo is meant to show the operator (org-publish) half, so its default
    // user must be a publisher (admin) — otherwise the governance demo is inert.
    const user = await ensureStaticSession();
    expect(user.roles).toContain('admin');
  });

  it('carries a baked gate posture as data', () => {
    expect(staticDemoConfig().gates).toMatchObject({ 'governance.publish': true });
  });
});
