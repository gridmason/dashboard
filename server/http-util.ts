/**
 * Small request/response helpers over `node:http`. The demo API is a reference
 * adapter, not a product surface, so it uses the platform HTTP server directly
 * (no framework dependency — see the PR rationale) with these thin helpers for
 * JSON bodies and the session cookie.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The stub-login session cookie name. */
export const SESSION_COOKIE = 'gm_session';

/** Send a JSON response with the given status. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

/** Send an empty response (no body) with the given status. */
export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

/** Thrown by {@link readJsonBody} when the request body is not a JSON object. */
export class BadRequestError extends Error {
  override readonly name = 'BadRequestError';
}

/** Read and JSON-parse the request body, requiring a JSON object. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') throw new BadRequestError('empty request body');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError('body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError('body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Parse the `Cookie` header into a name → value map. */
export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (header === undefined) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== '') out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** Set the session cookie (HttpOnly; scoped to the whole app; lax same-site). */
export function setSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`,
  );
}

/** Clear the session cookie by expiring it. */
export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
}
