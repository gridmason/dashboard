/**
 * The demo session bootstrap (docs/SPEC.md §1, GW-D21). Identity is a **host
 * concern** pre-1.0: Gridmason ships a stub login, not real authentication. The
 * dashboard is a single-tenant showcase, so on boot it silently signs in as a
 * checked-in demo user — enough to authorize the persistence adapter's calls and
 * to give layouts a concrete `user:<id>` scope. A real host replaces this whole
 * module with its own identity, and nothing above it changes.
 *
 * The credentials are the ones in `server/config/demo-config.json`; they are dev
 * credentials for a public demo, deliberately not a secret. The session cookie
 * is `HttpOnly` and set by the demo API, so this module never handles a token —
 * it only proves a session exists and reports who it belongs to.
 */

/** The public view of the signed-in user (mirrors the demo API's `SessionUser`). */
export interface SessionUser {
  readonly id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly roles: readonly string[];
}

/** The demo user the showcase signs in as. Dev credentials, not a secret (see above). */
const DEMO_USER = { username: 'alice', password: 'alice-dev-password' } as const;

/** Resolve the current session's user, or `undefined` if no session is active. */
async function currentUser(baseUrl: string): Promise<SessionUser | undefined> {
  const res = await fetch(`${baseUrl}/api/auth/me`, { credentials: 'include' });
  if (res.status === 401) return undefined;
  if (!res.ok) throw new Error(`auth/me failed (${res.status})`);
  return ((await res.json()) as { user: SessionUser }).user;
}

/** Sign in as the demo user and return the resulting session user. */
async function login(baseUrl: string): Promise<SessionUser> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(DEMO_USER),
  });
  if (!res.ok) throw new Error(`stub login failed (${res.status})`);
  return ((await res.json()) as { user: SessionUser }).user;
}

/**
 * Ensure a stub session exists, reusing one already established (a prior visit's
 * `HttpOnly` cookie survives reload) and signing in as the demo user otherwise.
 * Returns the signed-in user — its `id` is the `user:<id>` layout scope.
 *
 * @param baseUrl Base URL the demo API is served under; `''` (default) is the
 *   same-origin proxy the app is deployed behind.
 */
export async function ensureSession(baseUrl = ''): Promise<SessionUser> {
  return (await currentUser(baseUrl)) ?? (await login(baseUrl));
}
