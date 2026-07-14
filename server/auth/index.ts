/**
 * The stub login (GW-D21, FR-6): config-file users, no real authentication, no
 * SSO — identity is a host concern pre-1.0 (SPEC §1). This service issues an
 * opaque in-memory session id on a correct username/password and resolves it
 * back to a public user view; protected routes are gated on it (see app.ts).
 *
 * Sessions live in memory only: they are dropped on restart, which is correct
 * for a single-tenant demo. The reference host-SDK enforcement
 * (remote-identity + `min(user, widget-capability)`) that layers on top of this
 * lands in Phase B (SPEC §6).
 */
import { randomUUID } from 'node:crypto';
import type { DemoConfig, DemoUser } from '../config/index';

/** The public view of a user — the password is never included. */
export interface SessionUser {
  readonly id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly roles: readonly string[];
}

function toSessionUser(user: DemoUser): SessionUser {
  return {
    id: user.id,
    username: user.username,
    roles: user.roles ?? [],
    ...(user.displayName !== undefined ? { displayName: user.displayName } : {}),
  };
}

export class AuthService {
  readonly #usersByName = new Map<string, DemoUser>();
  readonly #usersById = new Map<string, DemoUser>();
  /** session id → user id. */
  readonly #sessions = new Map<string, string>();

  constructor(config: DemoConfig) {
    for (const user of config.users) {
      this.#usersByName.set(user.username, user);
      this.#usersById.set(user.id, user);
    }
  }

  /**
   * Validate credentials against the config users. On success returns a fresh
   * session id and the public user view; on failure returns `undefined` — the
   * caller must not distinguish unknown-user from wrong-password.
   */
  login(username: string, password: string): { sessionId: string; user: SessionUser } | undefined {
    const user = this.#usersByName.get(username);
    if (user === undefined || user.password !== password) return undefined;
    const sessionId = randomUUID();
    this.#sessions.set(sessionId, user.id);
    return { sessionId, user: toSessionUser(user) };
  }

  /** Drop a session. Idempotent. */
  logout(sessionId: string | undefined): void {
    if (sessionId !== undefined) this.#sessions.delete(sessionId);
  }

  /** Resolve a session id to its public user, or `undefined` if not signed in. */
  userForSession(sessionId: string | undefined): SessionUser | undefined {
    if (sessionId === undefined) return undefined;
    const userId = this.#sessions.get(sessionId);
    if (userId === undefined) return undefined;
    const user = this.#usersById.get(userId);
    return user === undefined ? undefined : toSessionUser(user);
  }
}
