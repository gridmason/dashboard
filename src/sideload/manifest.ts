/**
 * The dev-server descriptors the dashboard reads to admit a sideload remote
 * (docs/SPEC.md §4). This module holds **two** contracts, deliberately kept
 * apart because their servers are different things:
 *
 * 1. **The real `gridmason dev` contract** (`@gridmason/cli`, gridmason/cli#28 —
 *    verified against `@gridmason/cli@0.0.1` for issue #38). This is what the
 *    **dev** sideload path ({@link DevSideloadProvider}) reads. `gridmason dev`
 *    serves its live, re-validated manifest at {@link DEV_MANIFEST_PATH}:
 *
 *    ```json
 *    { "valid": true, "violations": [], "tag": "acme-note", "entry": "src/entry.js" }
 *    ```
 *
 *    Its dev-only routes are namespaced under `/@dev/` so they never collide with
 *    a widget source path served from the project tree. The dashboard reads `tag`
 *    (the custom element to place) and `entry` (a **project-relative** module
 *    path, resolved against the origin — `src/entry.js` → `http://origin/src/entry.js`),
 *    refuses a manifest the server reports invalid (surfacing its `violations`),
 *    and reads the human display name best-effort from the raw `manifest.json`
 *    the server also serves ({@link RAW_MANIFEST_PATH}), falling back to the tag.
 *    See {@link parseDevManifest} / {@link fetchDevManifest}.
 *
 * 2. **The generic widget-descriptor contract** ({@link WIDGET_DESCRIPTOR_PATH}),
 *    a small `{ tag, name, entry }` JSON descriptor. This serves the
 *    **acknowledged** sideload path ({@link ApiAcknowledgedSideload}), whose
 *    remotes are arbitrary deployed hosts (registry / CDN / self-hosted) rather
 *    than a `gridmason dev` server, and which pins the entry's content hash.
 *    That contract is #12's concern and is not pinned by any real server yet, so
 *    it is left as the SPEC-literal descriptor. See {@link parseWidgetDescriptor}
 *    / {@link fetchWidgetDescriptor}.
 *
 * Both parsers are pure and total (never throw) so a malformed descriptor
 * surfaces as a rejected registration, not a crash, and both are unit-testable
 * without a network.
 */
import type { DevSideloadRegistration } from './allowlist-store';

/** The `gridmason dev` live-manifest endpoint (real `@gridmason/cli` contract). */
export const DEV_MANIFEST_PATH = '/@dev/manifest';

/**
 * The raw `manifest.json` `gridmason dev` also serves from the project tree — the
 * only place the widget's human display `name` is exposed (the `/@dev/` manifest
 * endpoint projects just `valid`/`violations`/`tag`/`entry`).
 */
export const RAW_MANIFEST_PATH = '/manifest.json';

/** The generic widget descriptor path the acknowledged path registers against. */
export const WIDGET_DESCRIPTOR_PATH = '/gridmason.widget.json';

/** The `gridmason dev` `/@dev/manifest` response shape (real `@gridmason/cli` contract). */
export interface DevServerManifest {
  /** Whether the live manifest passed the dev server's structural + tag validation. */
  readonly valid: boolean;
  /** Human-readable reasons the manifest is invalid (empty when {@link valid}). */
  readonly violations: readonly string[];
  /** The custom-element tag the served entry defines, or `null` when unusable. */
  readonly tag: string | null;
  /** The project-relative entry module path, or `null` when unusable. */
  readonly entry: string | null;
}

/** The generic descriptor a non-`gridmason dev` host serves so the dashboard can admit its widget. */
export interface WidgetDescriptor {
  /** The custom-element tag the served ES module defines. */
  readonly tag: string;
  /** Human display name for the card + picker entry. */
  readonly name: string;
  /** Path (or absolute URL) of the ES-module entry, resolved against the origin. */
  readonly entry: string;
}

/** The result of validating a fetched descriptor: a registration, or a reason it was rejected. */
export type ParsedManifest =
  | { readonly ok: true; readonly registration: DevSideloadRegistration }
  | { readonly ok: false; readonly error: string };

/**
 * A valid custom-element name (HTML spec, simplified to the shape widget tags
 * take): starts with an ASCII letter, contains a hyphen, lowercase, no spaces.
 * A tag that fails this would make `customElements.define` throw at mount, so it
 * is rejected up front — the same posture core's catalog takes (`invalid-tag`).
 */
const CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9]*-[a-z0-9-]*$/;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Normalize a user-entered origin to its canonical `scheme://host[:port]` form. */
export function normalizeOrigin(origin: string): string {
  return new URL(origin).origin;
}

function ensureTrailingSlash(origin: string): string {
  return origin.endsWith('/') ? origin : `${origin}/`;
}

/**
 * Resolve a descriptor `entry` against `origin`: a project-relative path
 * (`src/entry.js`) or a rooted path (`/entry.js`) becomes absolute on the dev
 * server; an absolute URL is kept only if it stays on the same origin (a remote
 * serves its own code — no redirect to a third origin).
 */
function resolveEntry(
  entry: string,
  origin: string,
): { readonly ok: true; readonly entryUrl: string } | { readonly ok: false; readonly error: string } {
  try {
    const resolved = new URL(entry, ensureTrailingSlash(origin));
    if (resolved.origin !== new URL(origin).origin) {
      return { ok: false, error: 'manifest "entry" points off the dev-server origin' };
    }
    return { ok: true, entryUrl: resolved.href };
  } catch {
    return { ok: false, error: `manifest "entry" is not a resolvable URL: ${entry}` };
  }
}

// --- Contract 1: the real `gridmason dev` `/@dev/manifest` ---

/**
 * Validate a `gridmason dev` `/@dev/manifest` response for `origin` and resolve
 * its `entry` to an absolute URL on that origin. `name` is the display name read
 * separately from the raw manifest (the `/@dev/` endpoint does not carry it);
 * it falls back to the tag. Returns a {@link DevSideloadRegistration} ready for
 * the allowlist, or a human error. Total — never throws.
 */
export function parseDevManifest(value: unknown, origin: string, name?: string): ParsedManifest {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'dev manifest response is not a JSON object' };
  }
  const record = value as Record<string, unknown>;
  // The dev server re-validates the manifest live; refuse one it flags invalid so
  // the author fixes it before the dashboard tries to mount a broken widget.
  if (record.valid === false) {
    const violations = Array.isArray(record.violations)
      ? record.violations.filter((v): v is string => typeof v === 'string')
      : [];
    return {
      ok: false,
      error: violations.length
        ? `dev manifest is invalid: ${violations.join('; ')}`
        : 'dev manifest is invalid',
    };
  }
  const tag = asString(record.tag);
  const entry = asString(record.entry);
  if (tag === undefined) return { ok: false, error: 'dev manifest is missing a "tag"' };
  if (!CUSTOM_ELEMENT_NAME.test(tag)) {
    return { ok: false, error: `"${tag}" is not a valid custom-element tag` };
  }
  if (entry === undefined) return { ok: false, error: 'dev manifest is missing an "entry"' };

  const resolved = resolveEntry(entry, origin);
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    registration: { origin: normalizeOrigin(origin), entryUrl: resolved.entryUrl, tag, name: name ?? tag },
  };
}

/**
 * Fetch and validate the `gridmason dev` live manifest for `origin`. Reads
 * {@link DEV_MANIFEST_PATH} for the validated tag + entry, and — best-effort —
 * {@link RAW_MANIFEST_PATH} for the human display name (an absent/unreachable raw
 * manifest just falls the name back to the tag). Rejects with a human message on
 * a network error or an invalid manifest, so the dev UI can show the owner why a
 * registration failed. `fetchImpl` is injectable for tests.
 */
export async function fetchDevManifest(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DevSideloadRegistration> {
  const manifestUrl = new URL(DEV_MANIFEST_PATH, ensureTrailingSlash(origin)).href;
  let response: Response;
  try {
    response = await fetchImpl(manifestUrl);
  } catch (cause) {
    throw new Error(`could not reach dev server at ${origin}`, { cause });
  }
  if (!response.ok) {
    throw new Error(`dev server returned ${response.status} for ${DEV_MANIFEST_PATH}`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  const name = await fetchDisplayName(origin, fetchImpl);
  const parsed = parseDevManifest(body, origin, name);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.registration;
}

/** Best-effort display name from the raw `manifest.json`; `undefined` if unavailable. */
async function fetchDisplayName(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(new URL(RAW_MANIFEST_PATH, ensureTrailingSlash(origin)).href);
    if (!response.ok) return undefined;
    const body: unknown = await response.json().catch(() => undefined);
    if (typeof body === 'object' && body !== null) {
      return asString((body as Record<string, unknown>).name);
    }
  } catch {
    // Best-effort: a missing/unreachable raw manifest falls the name back to the tag.
  }
  return undefined;
}

// --- Contract 2: the generic `{ tag, name, entry }` descriptor (acknowledged path) ---

/**
 * Validate a generic widget descriptor for `origin` and resolve its `entry` to
 * an absolute same-origin URL. Returns a {@link DevSideloadRegistration} ready
 * for the allowlist, or a human error. Total — never throws.
 */
export function parseWidgetDescriptor(value: unknown, origin: string): ParsedManifest {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'widget descriptor is not a JSON object' };
  }
  const record = value as Record<string, unknown>;
  const tag = asString(record.tag);
  const name = asString(record.name);
  const entry = asString(record.entry);
  if (tag === undefined) return { ok: false, error: 'descriptor is missing a "tag"' };
  if (!CUSTOM_ELEMENT_NAME.test(tag)) {
    return { ok: false, error: `"${tag}" is not a valid custom-element tag` };
  }
  if (entry === undefined) return { ok: false, error: 'descriptor is missing an "entry"' };

  const resolved = resolveEntry(entry, origin);
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    registration: { origin: normalizeOrigin(origin), entryUrl: resolved.entryUrl, tag, name: name ?? tag },
  };
}

/**
 * Fetch and validate the generic widget descriptor for `origin`. Rejects with a
 * human message on a network error or an invalid descriptor. `fetchImpl` is
 * injectable for tests.
 */
export async function fetchWidgetDescriptor(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DevSideloadRegistration> {
  const descriptorUrl = new URL(WIDGET_DESCRIPTOR_PATH, ensureTrailingSlash(origin)).href;
  let response: Response;
  try {
    response = await fetchImpl(descriptorUrl);
  } catch (cause) {
    throw new Error(`could not reach dev server at ${origin}`, { cause });
  }
  if (!response.ok) {
    throw new Error(`dev server returned ${response.status} for ${WIDGET_DESCRIPTOR_PATH}`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = parseWidgetDescriptor(body, origin);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.registration;
}
