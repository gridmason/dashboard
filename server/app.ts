/**
 * The demo API service (FR-5, FR-6, SPEC §6): the backend the dashboard's
 * reference persistence adapter talks to. This module wires the config, the
 * layout KV store, and the stub login into an `http.Server`, and dispatches the
 * small route set below. Everything under `/api/layouts` and `/api/auth/me` is
 * gated on a valid stub-login session.
 *
 *   GET    /api/health                                  (public) liveness
 *   POST   /api/auth/login                              (public) stub login
 *   POST   /api/auth/logout                             (public) drop session
 *   GET    /api/auth/me                                 (auth)   current user
 *   GET    /api/layouts/:scope/:pageType[/:entityId]    (auth)   read LayoutDoc
 *   PUT    /api/layouts/:scope/:pageType[/:entityId]    (auth)   write LayoutDoc
 *   DELETE /api/layouts/:scope/:pageType[/:entityId]    (auth)   delete LayoutDoc
 *   GET    /api/governance/:scope/:pageType[/:entityId] (auth)   read OrgPublication
 *   PUT    /api/governance/:scope/:pageType[/:entityId] (admin)  publish org layout+locks
 *   DELETE /api/governance/:scope/:pageType[/:entityId] (admin)  unpublish
 *
 * Publishing (and un-publishing) an org layout is the one privileged action — it
 * is gated on the caller holding the publisher role **and** the `governance.publish`
 * config gate being on (SPEC §5/§6, the simple role stub). Everything else is
 * gated only on a valid stub-login session.
 *
 * `createApp` returns an unlistened server so callers (and tests) own the port.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AuthService, SessionUser } from './auth/index';
import type { DemoConfig } from './config/index';
import { isLayoutDoc, type LayoutKey, type LayoutStore } from './layout-store/index';
import {
  isOrgPublication,
  type GovernanceKey,
  type GovernanceStore,
} from './governance-store/index';
import {
  BadRequestError,
  clearSessionCookie,
  parseCookies,
  readJsonBody,
  sendEmpty,
  sendJson,
  setSessionCookie,
  SESSION_COOKIE,
} from './http-util';

/** The role a user must hold to publish an org layout (SPEC §6 role stub). */
const PUBLISHER_ROLE = 'admin';

/** The config gate that must be on for org publishing to be permitted at all. */
const PUBLISH_GATE = 'governance.publish';

/** The collaborators the demo API is built over. */
export interface AppDeps {
  readonly config: DemoConfig;
  readonly store: LayoutStore;
  readonly governance: GovernanceStore;
  readonly auth: AuthService;
}

/** Build the demo API server. The returned server is not yet listening. */
export function createApp(deps: AppDeps): Server {
  return createServer((req, res) => {
    handle(deps, req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
    });
  });
}

async function handle(deps: AppDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter((s) => s !== '').map(decodeURIComponent);
  const method = req.method ?? 'GET';

  if (segments[0] !== 'api') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  // GET /api/health — public liveness probe (also proves the service booted in CI).
  if (method === 'GET' && segments.length === 2 && segments[1] === 'health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (segments[1] === 'auth') {
    await handleAuth(deps, req, res, method, segments.slice(2));
    return;
  }

  if (segments[1] === 'layouts') {
    await handleLayouts(deps, req, res, method, segments.slice(2));
    return;
  }

  if (segments[1] === 'governance') {
    await handleGovernance(deps, req, res, method, segments.slice(2));
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function handleAuth(
  deps: AppDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  rest: readonly string[],
): Promise<void> {
  // POST /api/auth/login
  if (method === 'POST' && rest.length === 1 && rest[0] === 'login') {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof BadRequestError ? err.message : 'bad_request' });
      return;
    }
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string') {
      sendJson(res, 400, { error: 'username and password are required' });
      return;
    }
    const result = deps.auth.login(username, password);
    if (result === undefined) {
      sendJson(res, 401, { error: 'invalid_credentials' });
      return;
    }
    setSessionCookie(res, result.sessionId);
    sendJson(res, 200, { user: result.user });
    return;
  }

  // POST /api/auth/logout
  if (method === 'POST' && rest.length === 1 && rest[0] === 'logout') {
    deps.auth.logout(parseCookies(req)[SESSION_COOKIE]);
    clearSessionCookie(res);
    sendEmpty(res, 204);
    return;
  }

  // GET /api/auth/me — protected
  if (method === 'GET' && rest.length === 1 && rest[0] === 'me') {
    const user = requireAuth(deps, req, res);
    if (user === undefined) return;
    sendJson(res, 200, { user });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function handleLayouts(
  deps: AppDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  rest: readonly string[],
): Promise<void> {
  const user = requireAuth(deps, req, res);
  if (user === undefined) return;

  const key = keyFromSegments(rest);
  if (key === undefined) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  if (method === 'GET') {
    const doc = deps.store.get(key);
    if (doc === undefined) {
      sendJson(res, 404, { error: 'layout_not_found' });
      return;
    }
    sendJson(res, 200, doc);
    return;
  }

  if (method === 'PUT') {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof BadRequestError ? err.message : 'bad_request' });
      return;
    }
    if (!isLayoutDoc(body)) {
      sendJson(res, 400, { error: 'body is not a valid LayoutDoc' });
      return;
    }
    deps.store.put(key, body);
    sendJson(res, 200, deps.store.get(key));
    return;
  }

  if (method === 'DELETE') {
    const existed = deps.store.delete(key);
    sendEmpty(res, existed ? 204 : 404);
    return;
  }

  sendJson(res, 405, { error: 'method_not_allowed' });
}

async function handleGovernance(
  deps: AppDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  rest: readonly string[],
): Promise<void> {
  const user = requireAuth(deps, req, res);
  if (user === undefined) return;

  const key = keyFromSegments(rest);
  if (key === undefined) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  // Reading a publication only needs a session — a user must see the org layout
  // and locks that govern their page.
  if (method === 'GET') {
    const publication = deps.governance.get(key);
    if (publication === undefined) {
      sendJson(res, 404, { error: 'publication_not_found' });
      return;
    }
    sendJson(res, 200, publication);
    return;
  }

  // Publishing and un-publishing are privileged: the caller must be a publisher
  // and the config gate must be on (SPEC §5 — the operator, not an end user).
  if (method === 'PUT' || method === 'DELETE') {
    if (!canPublish(deps.config, user)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }

    if (method === 'DELETE') {
      const existed = deps.governance.delete(key);
      sendEmpty(res, existed ? 204 : 404);
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof BadRequestError ? err.message : 'bad_request' });
      return;
    }
    if (!isOrgPublication(body) || !isLayoutDoc(body.layout)) {
      sendJson(res, 400, { error: 'body is not a valid org publication' });
      return;
    }
    deps.governance.put(key, { layout: body.layout, locks: body.locks });
    sendJson(res, 200, deps.governance.get(key));
    return;
  }

  sendJson(res, 405, { error: 'method_not_allowed' });
}

/**
 * Whether `user` may publish an org layout: they hold the publisher role and the
 * `governance.publish` config gate is on. The simple role stub (SPEC §6) — real
 * per-node/per-role authorization is a host concern pre-1.0 (GW-D21).
 */
function canPublish(config: DemoConfig, user: SessionUser): boolean {
  return config.gates[PUBLISH_GATE] === true && user.roles.includes(PUBLISHER_ROLE);
}

/** Build a {@link GovernanceKey} / {@link LayoutKey} from the `[scope, pageType, entityId?]` path tail. */
function keyFromSegments(rest: readonly string[]): (LayoutKey & GovernanceKey) | undefined {
  if (rest.length === 2) {
    return { scope: rest[0]!, pageType: rest[1]! };
  }
  if (rest.length === 3) {
    return { scope: rest[0]!, pageType: rest[1]!, entityId: rest[2]! };
  }
  return undefined;
}

/**
 * Resolve the caller's session, or reject with 401 and return `undefined`. A
 * route that gets `undefined` has already had its response sent.
 */
function requireAuth(deps: AppDeps, req: IncomingMessage, res: ServerResponse): SessionUser | undefined {
  const user = deps.auth.userForSession(parseCookies(req)[SESSION_COOKIE]);
  if (user === undefined) {
    sendJson(res, 401, { error: 'unauthenticated' });
    return undefined;
  }
  return user;
}
