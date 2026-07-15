/**
 * The shell-owned **session-token rail** held inside the Service Worker
 * (docs/SPEC.md §3; FR-14) — the pure, unit-testable core the SW glue drives (the
 * SW file itself is not unit-tested; there are no SW globals under Node, so the
 * decision logic lives here, mirroring `./enforcement-table` and `./verify-fetch`).
 *
 * SPEC §3 token hardening: "the session token is held in a shell-owned Service
 * Worker, **never readable by page/widget JS**; the SW attaches auth to every
 * outbound API call." This module is where that holds:
 *
 * - the token is captured in the {@link SessionTokenHolder}'s **private** field —
 *   there is deliberately **no getter** that returns it; the only way it leaves is
 *   as the `authorization` header {@link SessionTokenHolder.stamp} writes onto an
 *   outbound API request. Page/widget JS holds no reference to the holder (it lives
 *   in the SW module scope), so it can neither read nor forward the token;
 * - it is delivered to the SW by a page→SW `postMessage` hand-off
 *   ({@link isSessionTokenMessage}) and kept **in memory only** — unlike the
 *   enforcement table it is never persisted to the Cache API, so a killed worker
 *   simply has no token until the page re-hands it (fail closed: the SW attaches
 *   nothing rather than a stale credential);
 * - the per-instance identity token (`@gridmason/sdk`) rides a *separate* rail
 *   (`x-gridmason-instance-token`, set by the SDK transport, passed through
 *   untouched here) — this rail carries only the session credential.
 */

/** The `postMessage` type the page uses to hand (or clear) the SW's session token. */
export const SESSION_TOKEN_MESSAGE_TYPE = 'gm-sw/session-token';

/** The header the session credential is attached under on an outbound API call. */
export const SESSION_AUTH_HEADER = 'authorization';

/** A page→SW session-token hand-off: a non-empty `token` to remember, or `null` to clear. */
export interface SessionTokenMessage {
  readonly type: typeof SESSION_TOKEN_MESSAGE_TYPE;
  readonly token: string | null;
}

/** Whether `data` is a well-formed {@link SessionTokenMessage}. Pure; never throws. */
export function isSessionTokenMessage(data: unknown): data is SessionTokenMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  if (msg.type !== SESSION_TOKEN_MESSAGE_TYPE) return false;
  return typeof msg.token === 'string' || msg.token === null;
}

/**
 * Whether `url` is a **same-origin `/api/*`** request — the calls the SW attaches
 * session auth to. Third-party origins (registry CDNs, etc.) are never stamped
 * with the session credential. Pure; a malformed URL is treated as not-API.
 */
export function isSameOriginApiRequest(url: string, selfOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === selfOrigin && (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/'));
}

/**
 * Holds the SW's session token privately and stamps it onto outbound API requests.
 * There is no accessor that returns the raw token — see the module doc; the only
 * egress is {@link stamp}.
 */
export class SessionTokenHolder {
  #token: string | undefined;

  /** Remember a non-empty token handed by the page; an empty string clears it. */
  remember(token: string): void {
    this.#token = token === '' ? undefined : token;
  }

  /** Forget the token (logout / hand-off of `null`). */
  clear(): void {
    this.#token = undefined;
  }

  /** Whether a token is currently held (so the SW knows to stamp / intercept). */
  has(): boolean {
    return this.#token !== undefined;
  }

  /**
   * Return a copy of `headers` with the session credential attached under
   * {@link SESSION_AUTH_HEADER} when a token is held; the original map otherwise
   * (a no-op when nothing is held). Overwrites any caller-supplied value under that
   * header so a page script cannot pre-seed a different credential. Never mutates
   * the input.
   */
  stamp(headers: Readonly<Record<string, string>>): Record<string, string> {
    if (this.#token === undefined) return { ...headers };
    const out: Record<string, string> = {};
    // Drop any case-variant of the auth header the caller supplied, then set ours.
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== SESSION_AUTH_HEADER) out[name] = value;
    }
    out[SESSION_AUTH_HEADER] = `Bearer ${this.#token}`;
    return out;
  }
}
