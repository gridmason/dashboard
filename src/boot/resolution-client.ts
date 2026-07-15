/**
 * Boot step 2 — the **registry resolution API client** (docs/SPEC.md §2, §8, FR-10;
 * gridmason/registry `docs/api/resolution.md`, contract R-E2).
 *
 * Sends a {@link GateSnapshot} (../boot/gate-snapshot) to `POST /v1/resolve` and
 * returns the {@link ImportMapFragment} the registry answers with — the bare
 * specifier → hash-pinned URL map, the `scopes` for shared-dep skews, the per-module
 * {@link SignatureBundle}s, and the `excluded` list. The next step
 * (../boot/import-map-assembly) merges this fragment into the shell's import map.
 *
 * **Anonymous, no control plane (registry SPEC §1, §8).** The call carries **no**
 * authentication and requires **no** deployment registration — a registry is supply
 * chain the host reads, never a service the deployment must phone. This client
 * therefore sends only the snapshot body and reads only the fragment.
 *
 * **Carries signature bundles through untouched.** Each resolved module's `bundle`
 * is the untrusted, network-delivered input to `verifyRelease`; this client does
 * **not** verify anything — verification happens on the lazy verified-mount path
 * (#16) and in the Service Worker (#19). The fragment is returned exactly as
 * received (bundles included, by reference), so nothing here is trusted for having
 * passed through it: this module is transport, not trust.
 */
import type { GateSnapshot, ImportMapFragment } from '@gridmason/protocol';

/** Options for {@link resolveGateSnapshot}. */
export interface ResolveOptions {
  /**
   * The absolute `POST /v1/resolve` endpoint of the target registry's resolution
   * API (e.g. `https://registry.gridmason.dev/v1/resolve`). This is the resolution
   * surface; the serving origin the returned root-relative URLs are composed
   * against is a **separate** pin the assembly step is given (#12).
   */
  readonly endpoint: string;
  /** `fetch` implementation. Defaults to the global — overridden in tests. */
  readonly fetchImpl?: typeof fetch;
  /** Optional abort signal, so a slow resolve can be cancelled on teardown. */
  readonly signal?: AbortSignal;
}

/**
 * A typed resolution failure: a non-2xx `POST /v1/resolve`, a transport error, or a
 * response that is not a well-formed fragment. `code` is the registry's error code
 * (`invalid_request`, `wrong_registry`) when the body carried one, or a synthetic
 * `code` for transport/shape failures; `status` is the HTTP status when there was a
 * response. A *resolved* module that could not be served is **not** an error — it
 * arrives in the fragment's `excluded` list (so the host can render its fallback
 * card); only a failure of the call itself throws.
 */
export class ResolutionError extends Error {
  override readonly name = 'ResolutionError';
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Shape of the registry's error envelope: `{ error: { code, message } }`. */
interface ErrorEnvelope {
  readonly error: { readonly code: string; readonly message: string };
}

/**
 * Resolve a gate snapshot to an import-map fragment. Anonymous `POST /v1/resolve`
 * of the snapshot; on `200` the parsed fragment is returned **untouched** (signature
 * bundles carried by reference — verification is a later step). Any non-2xx, a
 * transport error, or a malformed body throws {@link ResolutionError}. An empty
 * snapshot is a valid request and returns an empty fragment.
 */
export async function resolveGateSnapshot(
  snapshot: GateSnapshot,
  options: ResolveOptions,
): Promise<ImportMapFragment> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(snapshot),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    throw new ResolutionError('network_error', `resolve request failed: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    throw await resolutionErrorFromResponse(response);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ResolutionError(
      'invalid_response',
      `resolve response was not valid JSON: ${(cause as Error).message}`,
      response.status,
    );
  }

  if (!isImportMapFragment(body)) {
    throw new ResolutionError(
      'invalid_response',
      'resolve response did not match the import-map-fragment shape',
      response.status,
    );
  }
  return body;
}

/** Build a {@link ResolutionError} from a non-2xx response, reading its error envelope if present. */
async function resolutionErrorFromResponse(response: Response): Promise<ResolutionError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (isErrorEnvelope(body)) {
    return new ResolutionError(body.error.code, body.error.message, response.status);
  }
  return new ResolutionError('resolve_failed', `resolve failed with status ${response.status}`, response.status);
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

/**
 * Structural check that a body is an import-map fragment (registry, imports, scopes,
 * modules, excluded). Shape only — every field stays untrusted input to the verify
 * step; this just refuses a body the assembler could not consume.
 */
function isImportMapFragment(value: unknown): value is ImportMapFragment {
  return (
    isRecord(value) &&
    typeof value.registry === 'string' &&
    isRecord(value.imports) &&
    isRecord(value.scopes) &&
    Array.isArray(value.modules) &&
    Array.isArray(value.excluded)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
