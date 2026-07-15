/**
 * The reference-host HTTP surface for the instance-token rail (docs/SPEC.md §3,
 * §6; FR-9/FR-14) and the dev-proxy SDK endpoint (#34, cli FR-5). These are the
 * routes that make the SPEC §3 token claims true end to end:
 *
 *   POST   /api/sdk/instance          register a minted instance token → binding (auth)
 *   DELETE /api/sdk/instance          revoke this session's instance token   (auth)
 *   GET    /api/records/:type/:id     read a record   — gated `records.read:recordType:<type>`
 *   GET    /api/records/:type         query a record type — gated `records.read:recordType:<type>`
 *   PUT    /api/records/:type/:id     write a record  — gated `records.write:recordType:<type>`
 *   POST   /__gridmason_dev__/sdk     dev-proxy SDK forward leg (dev mode only)
 *
 * Every `/api/records/*` call is enforced through {@link enforceInstanceCapability}:
 * it needs a valid instance token *and* `min(user, widget)` for the derived
 * capability, so a widget that reached the API around the SDK (no token) is denied.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  grantsCapability,
  isDevProxySdkRequest,
  parseCapability,
  type Capability,
  type DevProxySdkResponse,
  type WidgetID,
} from '@gridmason/protocol';
import type { AuthService, SessionUser } from '../auth/index';
import { sideloadMode, type DemoConfig } from '../config/index';
import {
  BadRequestError,
  parseCookies,
  readJsonBody,
  sendEmpty,
  sendJson,
  SESSION_COOKIE,
} from '../http-util';
import {
  denialBody,
  enforceInstanceCapability,
  INSTANCE_TOKEN_HEADER,
  parseCapabilityString,
  type InstanceTokenRegistry,
} from './index';

/** The collaborators these routes need — a subset of the app's deps. */
export interface SdkRouteDeps {
  readonly auth: AuthService;
  readonly identity: InstanceTokenRegistry;
  readonly config: DemoConfig;
}

/** Resolve the caller's session user without sending a response, or `undefined`. */
function sessionUser(deps: SdkRouteDeps, req: IncomingMessage): SessionUser | undefined {
  return deps.auth.userForSession(parseCookies(req)[SESSION_COOKIE]);
}

/** The instance token a call carries (the SDK stamped it under {@link INSTANCE_TOKEN_HEADER}). */
function instanceToken(req: IncomingMessage): string | undefined {
  const value = req.headers[INSTANCE_TOKEN_HEADER];
  return Array.isArray(value) ? value[0] : value;
}

/** Synthesize the demo record for a ref — mirrors the client `LocalDemoTransport` (id-bearing name). */
function synthesizeRecord(recordType: string, id: string): { ref: { recordType: string; id: string }; fields: Record<string, unknown> } {
  return {
    ref: { recordType, id },
    fields: {
      name: `Demo ${recordType} ${id}`,
      recordType,
      id,
      summary: `Reference-host record served for ${recordType} ${id} (SPEC §6).`,
    },
  };
}

/** Validate a `{ source, tag }` widget identity from an untyped body. */
function toWidgetId(value: unknown): WidgetID | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { source, tag } = value as Record<string, unknown>;
  if (typeof source !== 'string' || source === '' || typeof tag !== 'string' || tag === '') return undefined;
  return { source, tag };
}

/**
 * `POST /api/sdk/instance` — register a minted instance token, and
 * `DELETE /api/sdk/instance` — revoke it. Registration binds the token to the
 * caller's session and the widget's declared capabilities (SPEC §3); a token is
 * only ever usable, or revocable, under the session that minted it.
 */
export async function handleSdkInstance(
  deps: SdkRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
): Promise<void> {
  const user = sessionUser(deps, req);
  if (user === undefined) {
    sendJson(res, 401, { error: 'unauthenticated' });
    return;
  }

  if (method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof BadRequestError ? err.message : 'bad_request' });
      return;
    }
    const { token, instanceId, widgetId: widgetIdRaw, capabilities: capsRaw } = body;
    if (typeof token !== 'string' || token === '' || typeof instanceId !== 'string' || instanceId === '') {
      sendJson(res, 400, { error: 'token and instanceId are required' });
      return;
    }
    const widgetId = toWidgetId(widgetIdRaw);
    if (widgetId === undefined) {
      sendJson(res, 400, { error: 'widgetId must be { source, tag }' });
      return;
    }
    if (!Array.isArray(capsRaw) || capsRaw.some((c) => typeof c !== 'string')) {
      sendJson(res, 400, { error: 'capabilities must be an array of capability strings' });
      return;
    }
    const declared: Capability[] = [];
    for (const cap of capsRaw as string[]) {
      const parsed = parseCapabilityString(cap);
      if (parsed === undefined) {
        sendJson(res, 400, { error: `invalid capability "${cap}"` });
        return;
      }
      declared.push(parsed);
    }
    deps.identity.register({ token, instanceId, widgetId, userId: user.id, declaredCapabilities: declared });
    sendJson(res, 201, { instanceId });
    return;
  }

  if (method === 'DELETE') {
    const token = instanceToken(req);
    const binding = deps.identity.resolve(token);
    // Only the owning session may revoke its own token — never another's.
    if (binding === undefined || binding.userId !== user.id) {
      sendEmpty(res, 404);
      return;
    }
    deps.identity.revoke(token);
    sendEmpty(res, 204);
    return;
  }

  sendJson(res, 405, { error: 'method_not_allowed' });
}

/**
 * The capability-gated reference records endpoint (SPEC §6). Read/query need
 * `records.read:recordType:<type>`, write needs `records.write:recordType:<type>`;
 * every call is enforced through the instance-token rail — a valid token *and*
 * `min(user, widget)` — so a bypassing page script (no token) is denied.
 */
export async function handleRecords(
  deps: SdkRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  rest: readonly string[],
): Promise<void> {
  const user = sessionUser(deps, req);
  if (user === undefined) {
    sendJson(res, 401, { error: 'unauthenticated' });
    return;
  }

  const recordType = rest[0];
  if (recordType === undefined || recordType === '') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const id = rest[1];

  const isRead = method === 'GET';
  const isWrite = method === 'PUT' && id !== undefined;
  if (!isRead && !isWrite) {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const required: Capability = {
    api: isWrite ? 'records.write' : 'records.read',
    scope: `recordType:${recordType}`,
  };
  const decision = enforceInstanceCapability({
    registry: deps.identity,
    token: instanceToken(req),
    user,
    required,
  });
  if (!decision.ok) {
    sendJson(res, decision.denial.status, denialBody(decision.denial));
    return;
  }

  // GET without an id is a query; GET with an id is a read.
  if (isRead && id === undefined) {
    sendJson(res, 200, [synthesizeRecord(recordType, `${recordType}-demo`)]);
    return;
  }
  if (isRead) {
    sendJson(res, 200, synthesizeRecord(recordType, id!));
    return;
  }

  // Write: apply the patch onto the synthesized record and echo it.
  let patch: Record<string, unknown>;
  try {
    patch = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof BadRequestError ? err.message : 'bad_request' });
    return;
  }
  const record = synthesizeRecord(recordType, id!);
  sendJson(res, 200, { ref: record.ref, fields: { ...record.fields, ...patch } });
}

/** Whether `user` grants `required` under scope-prefix containment. */
function userGrants(user: SessionUser, required: Capability): boolean {
  return user.capabilities.some((cap) => {
    const parsed = parseCapability(cap);
    if (!parsed.ok) return false;
    const declared: Capability = parsed.scope === undefined ? { api: parsed.api } : { api: parsed.api, scope: parsed.scope };
    return grantsCapability(declared, required);
  });
}

/**
 * The dev-proxy SDK forward-leg endpoint (`POST /__gridmason_dev__/sdk`, #34, cli
 * FR-5) — **dev mode only** (the deployment's sideload posture is `dev`). The CLI
 * forwards a widget's gated SDK call as a {@link DevProxySdkRequest}; the host
 * executes it against its reference SDK surface and answers with a
 * {@link DevProxySdkResponse}. Capability is pre-checked CLI-side against the
 * widget's declared set; the host additionally enforces the **user's** capabilities
 * (defence in depth), so a method the session user lacks is refused here too.
 */
export async function handleDevProxy(
  deps: SdkRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
): Promise<void> {
  // The endpoint does not exist outside dev mode — never a production attack surface.
  if (sideloadMode(deps.config) !== 'dev') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  const user = sessionUser(deps, req);
  if (user === undefined) {
    sendJson(res, 401, { error: 'unauthenticated' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const response: DevProxySdkResponse = {
      ok: false,
      error: err instanceof BadRequestError ? err.message : 'bad_request',
    };
    sendJson(res, 400, response);
    return;
  }
  if (!isDevProxySdkRequest(body)) {
    const response: DevProxySdkResponse = { ok: false, error: 'not a DevProxySdkRequest' };
    sendJson(res, 400, response);
    return;
  }

  const response = executeDevProxyCall(body.method, body.args, user);
  sendJson(res, 200, response);
}

/** Map one dev-proxy SDK call to a reference result, enforcing the user's capabilities. */
function executeDevProxyCall(method: string, args: readonly unknown[], user: SessionUser): DevProxySdkResponse {
  const firstString = (v: unknown, key: string): string | undefined => {
    if (typeof v !== 'object' || v === null) return undefined;
    const val = (v as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : undefined;
  };
  switch (method) {
    case 'records.read':
    case 'records.query': {
      const recordType = firstString(args[0], 'recordType');
      if (recordType === undefined) return { ok: false, error: 'missing recordType' };
      if (!userGrants(user, { api: 'records.read', scope: `recordType:${recordType}` })) {
        return { ok: false, error: 'permission_denied' };
      }
      const id = firstString(args[0], 'id') ?? `${recordType}-demo`;
      const record = synthesizeRecord(recordType, id);
      return { ok: true, value: method === 'records.query' ? [record] : record };
    }
    case 'records.write': {
      const recordType = firstString(args[0], 'recordType');
      const id = firstString(args[0], 'id');
      if (recordType === undefined || id === undefined) return { ok: false, error: 'missing record ref' };
      if (!userGrants(user, { api: 'records.write', scope: `recordType:${recordType}` })) {
        return { ok: false, error: 'permission_denied' };
      }
      return { ok: true, value: synthesizeRecord(recordType, id) };
    }
    case 'net.fetch': {
      const host = firstString(args[0], 'host');
      if (host === undefined) return { ok: false, error: 'missing host' };
      if (!userGrants(user, { api: 'net', scope: host })) {
        return { ok: false, error: 'permission_denied' };
      }
      return { ok: true, value: { status: 200, ok: true, headers: {}, body: '' } };
    }
    default:
      return { ok: false, error: `unsupported method "${method}"` };
  }
}
