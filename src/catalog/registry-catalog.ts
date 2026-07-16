/**
 * The **registry catalog client** (issue #85; contract: gridmason/registry#63) —
 * the anonymous read API the Add Widget picker lists a registry's published
 * widgets from.
 *
 *   GET <registry>/v1/widgets?query=&publisher=&limit=&cursor=
 *
 * Anonymous, wildcard-CORS (registry#57 posture). This client fetches and
 * defensively narrows the response; it decides **nothing** about trust or
 * addability — browsing the catalog must never bypass the deployment gate or the
 * verify chain (SPEC §2). Whether a listed widget can actually be placed is the
 * caller's call, made against the boot's admitted set (`./addability`).
 *
 * The endpoint is derived from the deployment's `resolveEndpoint` (same registry
 * origin, sibling path) so a deployment configures one registry URL, not two.
 */

/** One capability a widget declares (from the latest distributable version's manifest). */
export interface RegistryWidgetCapability {
  /** The capability api, e.g. `records.read`, `net`, `events`. */
  readonly api: string;
  /** Optional scope qualifier, e.g. `recordType:example`. */
  readonly scope?: string;
}

/** One widget in a registry's catalog (gridmason/registry#63 response item). */
export interface RegistryWidgetEntry {
  /** Publisher namespace prefix. */
  readonly publisher: string;
  /** The widget custom-element tag (publisher-prefixed). */
  readonly tag: string;
  /** Human display name (from the manifest). */
  readonly name: string;
  /** Optional description (from the manifest). */
  readonly description?: string;
  /** The latest distributable version. */
  readonly latestVersion: string;
  /** All distributable versions, newest first. */
  readonly versions: readonly string[];
  /** Capabilities of the latest distributable version. */
  readonly capabilities: readonly RegistryWidgetCapability[];
}

/** The `GET /v1/widgets` response (keyset-paginated). */
export interface RegistryWidgetList {
  readonly widgets: readonly RegistryWidgetEntry[];
  /** The cursor for the next page, or `null` at the end. */
  readonly nextCursor: string | null;
}

/** Query parameters for {@link fetchRegistryWidgets}. */
export interface RegistryWidgetQuery {
  /** Substring match over tag/name. */
  readonly query?: string;
  /** Restrict to one publisher. */
  readonly publisher?: string;
  /** Page size. */
  readonly limit?: number;
  /** Keyset pagination cursor. */
  readonly cursor?: string;
}

/** Injectable collaborators, for tests. */
export interface RegistryCatalogDeps {
  /** `fetch` to use. Defaults to the global. */
  readonly fetch?: typeof globalThis.fetch;
  /** Abort signal for the request. */
  readonly signal?: AbortSignal;
}

/** Thrown when the catalog endpoint answers with a non-2xx status or a malformed body. */
export class RegistryCatalogError extends Error {
  override readonly name = 'RegistryCatalogError';
  constructor(
    /** The registry catalog endpoint that failed. */
    readonly endpoint: string,
    detail: string,
  ) {
    super(`Registry catalog request to ${endpoint} failed: ${detail}`);
  }
}

/**
 * The `/v1/widgets` catalog endpoint for a registry, derived from its
 * `resolveEndpoint` (e.g. `http://localhost:8080/v1/resolve` →
 * `http://localhost:8080/v1/widgets`) — same origin, the registry's public read
 * surface. Throws if `resolveEndpoint` is not a valid absolute URL.
 */
export function widgetsEndpointFor(resolveEndpoint: string): string {
  return new URL('/v1/widgets', resolveEndpoint).href;
}

/** Build the query string for a catalog request (only non-empty params). */
function queryString(query: RegistryWidgetQuery): string {
  const params = new URLSearchParams();
  if (query.query !== undefined && query.query !== '') params.set('query', query.query);
  if (query.publisher !== undefined && query.publisher !== '') params.set('publisher', query.publisher);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined && query.cursor !== '') params.set('cursor', query.cursor);
  const serialized = params.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

/** Narrow one untrusted catalog item, dropping it (returning `undefined`) if it is unusable. */
function narrowEntry(value: unknown): RegistryWidgetEntry | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const { publisher, tag, name, latestVersion } = item;
  if (
    typeof publisher !== 'string' ||
    typeof tag !== 'string' ||
    typeof name !== 'string' ||
    typeof latestVersion !== 'string'
  ) {
    return undefined;
  }
  const versions = Array.isArray(item.versions)
    ? item.versions.filter((v): v is string => typeof v === 'string')
    : [];
  const capabilities = Array.isArray(item.capabilities)
    ? item.capabilities.flatMap((cap): RegistryWidgetCapability[] => {
        if (cap === null || typeof cap !== 'object') return [];
        const api = (cap as Record<string, unknown>).api;
        if (typeof api !== 'string') return [];
        const scope = (cap as Record<string, unknown>).scope;
        return [typeof scope === 'string' ? { api, scope } : { api }];
      })
    : [];
  return {
    publisher,
    tag,
    name,
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
    latestVersion,
    versions,
    capabilities,
  };
}

/**
 * Fetch (and defensively narrow) one page of a registry's widget catalog. Binds
 * the default `fetch` to `globalThis` (a bare `globalThis.fetch` reference is
 * called with the wrong receiver in some runtimes — see #83, load-bearing).
 * Throws {@link RegistryCatalogError} on a non-2xx status or a non-object body;
 * malformed individual entries are dropped rather than failing the whole page.
 */
export async function fetchRegistryWidgets(
  endpoint: string,
  query: RegistryWidgetQuery = {},
  deps: RegistryCatalogDeps = {},
): Promise<RegistryWidgetList> {
  const doFetch = (deps.fetch ?? globalThis.fetch).bind(globalThis);
  const url = `${endpoint}${queryString(query)}`;

  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { accept: 'application/json' },
      ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
    });
  } catch (cause) {
    throw new RegistryCatalogError(endpoint, `unreachable (${cause instanceof Error ? cause.message : String(cause)})`);
  }
  if (!response.ok) {
    throw new RegistryCatalogError(endpoint, `HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RegistryCatalogError(endpoint, 'response was not valid JSON');
  }
  if (body === null || typeof body !== 'object' || !Array.isArray((body as { widgets?: unknown }).widgets)) {
    throw new RegistryCatalogError(endpoint, 'response has no `widgets` array');
  }

  const widgets = (body as { widgets: unknown[] }).widgets
    .map(narrowEntry)
    .filter((entry): entry is RegistryWidgetEntry => entry !== undefined);
  const nextCursor = (body as { nextCursor?: unknown }).nextCursor;
  return { widgets, nextCursor: typeof nextCursor === 'string' ? nextCursor : null };
}
