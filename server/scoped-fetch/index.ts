/**
 * The host API **scoped-fetch proxy** (docs/SPEC.md §3, FR-13) — the reference
 * implementation of the one network path a `net:<host>` widget is allowed.
 *
 * SPEC §3 keeps `connect-src` minimal: a widget can open **no** browser
 * connection to a third-party host. Its `net.fetch` is instead routed to this
 * same-origin endpoint (`POST /api/scoped-fetch`), which **re-checks the widget's
 * declared host allowlist server-side** and only then forwards the request. The
 * browser therefore never connects to `api.acme.com` directly — it connects to
 * the host (`'self'`), and the host connects out. That is what lets `connect-src`
 * stay locked down while a `net:` widget still works, and why no widget capability
 * ever has to widen the CSP.
 *
 * ## The server-side re-check is the security boundary
 *
 * The declared host allowlist is resolved **server-side** from the caller's
 * per-instance identity ({@link InstanceCapabilityResolver}), never trusted from
 * the request body — a widget cannot grant itself a host by asking for it. The
 * requested `host` is checked against those declared `net:<host>` capabilities
 * with the protocol's scope-prefix containment (`grantsCapability`); a host no
 * declared capability grants is refused with `403` before any outbound fetch.
 *
 * ## Seam for the instance-token rail (#21 / FR-14)
 *
 * The per-instance token the SDK transport attaches ({@link INSTANCE_TOKEN_HEADER})
 * is read here and handed to the resolver; **minting and validating** that token
 * (mapping it to `(instanceId, widgetId, capabilities)`, and the audit trail) is
 * the parallel token-hardening work. This module fails **closed** at the seam: a
 * request whose token the resolver does not recognize resolves to *no*
 * capabilities and is denied, so the endpoint is safe before that rail lands — #21
 * replaces the resolver's backing without touching the re-check below.
 */
import type { Capability } from '@gridmason/protocol';
import { grantsCapability } from '@gridmason/protocol';
import { INSTANCE_TOKEN_HEADER } from '@gridmason/sdk';

/**
 * The header the SDK transport attaches the unforgeable per-instance token on
 * (SPEC §3) — the **one** pinned `@gridmason/sdk` contract constant
 * (`x-gridmason-instance-token`), re-exported so the proxy reads the exact slot
 * the SDK identity stamper writes (a divergent literal would silently drop every
 * token). The proxy reads it to resolve the caller's declared capabilities; it is
 * **never** forwarded to the upstream host.
 */
export { INSTANCE_TOKEN_HEADER };

/**
 * A scoped outbound request the proxy accepts — the wire form of the SDK's
 * `ScopedRequest` (host + path, never a full URL). The `host` is the value the
 * server re-checks against the declared `net:<host>` allowlist; `path` is composed
 * against it into the absolute upstream URL.
 */
export interface ScopedFetchRequest {
  /** The remote host, e.g. `api.acme.com` — gated by `net:<host>`. */
  readonly host: string;
  /** Request path (and query), e.g. `/v2/sales`. Must begin with `/`; never a full URL. */
  readonly path: string;
  /** HTTP method; defaults to `GET`. */
  readonly method?: string;
  /** Request headers to forward (the instance token is stripped, not forwarded). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request body, already serialized by the caller. */
  readonly body?: string;
}

/**
 * Resolves the declared capabilities bound to a per-instance token (SPEC §3: the
 * API maps the token to `(instanceId, widgetId, declared capabilities)`). This is
 * the seam the instance-token rail (#21) backs with real mint/validation; the
 * proxy re-checks the requested host against whatever this returns and treats an
 * `undefined` result as *no capabilities* (fail closed).
 */
export interface InstanceCapabilityResolver {
  /** The capabilities declared for `token`, or `undefined` if it maps to no known instance. */
  resolve(token: string | undefined): readonly Capability[] | undefined;
}

/** The subset of the global `fetch` the proxy uses — injectable so tests never hit the network. */
export type UpstreamFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
  },
) => Promise<UpstreamResponse>;

/** The upstream response shape the proxy consumes (a structural subset of `Response`). */
export interface UpstreamResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { forEach(cb: (value: string, name: string) => void): void };
  text(): Promise<string>;
}

/** The collaborators the scoped-fetch proxy is built over. */
export interface ScopedFetchService {
  /** Resolves the caller's declared capabilities from the per-instance token (the #21 seam). */
  readonly capabilities: InstanceCapabilityResolver;
  /** The outbound fetch (defaults to the global `fetch` in {@link createScopedFetchService}). */
  readonly upstream: UpstreamFetch;
}

/** The proxy's outcome: an upstream response to relay, or a refusal with a status + reason. */
export type ScopedFetchOutcome =
  | { readonly ok: true; readonly response: ScopedFetchResponsePayload }
  | { readonly ok: false; readonly status: number; readonly error: string };

/** The `ScopedResponse`-shaped JSON the endpoint returns on an allowed request. */
export interface ScopedFetchResponsePayload {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Request headers that must not be forwarded upstream (identity/transport hop headers). */
const STRIPPED_REQUEST_HEADERS = new Set([INSTANCE_TOKEN_HEADER, 'host', 'cookie', 'content-length']);

/**
 * Build a {@link ScopedFetchService} over an {@link InstanceCapabilityResolver},
 * defaulting the outbound fetch to the platform `fetch`. A deployment (or #21)
 * supplies the resolver; tests inject a stub `upstream` so the re-check is proven
 * without a network.
 */
export function createScopedFetchService(
  capabilities: InstanceCapabilityResolver,
  upstream: UpstreamFetch = defaultUpstreamFetch,
): ScopedFetchService {
  return { capabilities, upstream };
}

/** The default outbound fetch — the global `fetch`, adapted to {@link UpstreamFetch}. */
const defaultUpstreamFetch: UpstreamFetch = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });

/**
 * Validate the request body is a well-formed {@link ScopedFetchRequest}. Total —
 * returns the normalized request or a human reason (a `400`), never throws.
 */
export function parseScopedFetchRequest(
  value: unknown,
): { readonly ok: true; readonly value: ScopedFetchRequest } | { readonly ok: false; readonly error: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'scoped-fetch body must be a JSON object' };
  }
  const record = value as Record<string, unknown>;
  const host = record['host'];
  const path = record['path'];
  if (typeof host !== 'string' || host.trim() === '') {
    return { ok: false, error: 'scoped-fetch request is missing a "host"' };
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return { ok: false, error: 'scoped-fetch "path" must be an absolute path beginning with "/"' };
  }
  // `host` must be a bare host (optionally :port), never a full URL — the proxy
  // composes the scheme itself, so an attacker cannot smuggle `http://internal/…`
  // or a credentials/`@` host past the allowlist re-check by hiding it in `host`.
  if (/[/\\@?#]/.test(host) || host.includes('://')) {
    return { ok: false, error: 'scoped-fetch "host" must be a bare host, not a URL' };
  }
  const method = record['method'];
  if (method !== undefined && typeof method !== 'string') {
    return { ok: false, error: 'scoped-fetch "method" must be a string' };
  }
  const body = record['body'];
  if (body !== undefined && typeof body !== 'string') {
    return { ok: false, error: 'scoped-fetch "body" must be a string' };
  }
  const headers = record['headers'];
  if (headers !== undefined && (typeof headers !== 'object' || headers === null)) {
    return { ok: false, error: 'scoped-fetch "headers" must be an object' };
  }
  return {
    ok: true,
    value: {
      host: host.trim(),
      path,
      ...(typeof method === 'string' ? { method } : {}),
      ...(typeof body === 'string' ? { body } : {}),
      ...(headers !== undefined ? { headers: headers as Record<string, string> } : {}),
    },
  };
}

/** Whether `declared` grants a `net.fetch` to `host` (scope-prefix containment, SPEC §3.1). */
export function grantsNetHost(declared: readonly Capability[], host: string): boolean {
  const required: Capability = { api: 'net', scope: host };
  return declared.some((capability) => grantsCapability(capability, required));
}

/**
 * Run the scoped-fetch proxy for one already-parsed request. Resolves the caller's
 * declared capabilities from `token` (the #21 seam), **re-checks** the host against
 * them server-side, and only then forwards the request upstream over HTTPS. The
 * ordering is the contract: no capabilities → deny; host not declared → deny; both
 * pass → forward.
 */
export async function runScopedFetch(
  service: ScopedFetchService,
  token: string | undefined,
  request: ScopedFetchRequest,
): Promise<ScopedFetchOutcome> {
  // The declared allowlist is server-resolved from the instance identity, never the
  // body. An unrecognized token → no capabilities → denied (fail closed at the seam).
  const declared = service.capabilities.resolve(token);
  if (declared === undefined || declared.length === 0) {
    return { ok: false, status: 403, error: 'no_instance_capabilities' };
  }
  if (!grantsNetHost(declared, request.host)) {
    return { ok: false, status: 403, error: 'net_host_not_allowed' };
  }

  const method = (request.method ?? 'GET').toUpperCase();
  const url = `https://${request.host}${request.path}`;
  const forwardHeaders = forwardableHeaders(request.headers);

  let upstream: UpstreamResponse;
  try {
    upstream = await service.upstream(url, {
      method,
      headers: forwardHeaders,
      ...(request.body !== undefined ? { body: request.body } : {}),
    });
  } catch {
    // A failed outbound fetch is a bad gateway, not a server fault — the widget
    // gets a scoped error it can surface, no upstream detail leaks.
    return { ok: false, status: 502, error: 'upstream_fetch_failed' };
  }

  return {
    ok: true,
    response: {
      status: upstream.status,
      ok: upstream.ok,
      headers: collectHeaders(upstream.headers),
      body: await upstream.text(),
    },
  };
}

/**
 * A reference in-memory {@link InstanceCapabilityResolver}: a `token → declared
 * capabilities` map. This is the Phase-A stand-in for the instance-token rail
 * (#21) — the demo wires it **empty**, so scoped-fetch denies every call until a
 * real token is minted (fail closed), and a test seeds it to exercise the allow
 * and deny paths. #21 swaps this backing for its mint/validation without changing
 * the {@link runScopedFetch} re-check.
 */
export class StaticInstanceCapabilityStore implements InstanceCapabilityResolver {
  readonly #byToken = new Map<string, readonly Capability[]>();

  /** Bind `token` to the capabilities declared for its instance. */
  set(token: string, capabilities: readonly Capability[]): void {
    this.#byToken.set(token, capabilities);
  }

  /** Drop a token's binding (e.g. on unmount). */
  delete(token: string): void {
    this.#byToken.delete(token);
  }

  resolve(token: string | undefined): readonly Capability[] | undefined {
    return token === undefined ? undefined : this.#byToken.get(token);
  }
}

/** Drop hop/identity headers before forwarding; the host attaches its own outbound auth. */
function forwardableHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers === undefined) return out;
  for (const [name, value] of Object.entries(headers)) {
    if (!STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/** Flatten an upstream header collection into a plain name → value map. */
function collectHeaders(headers: UpstreamResponse['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}
