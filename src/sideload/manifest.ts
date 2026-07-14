/**
 * The dev-server widget descriptor the dashboard reads to admit a `gridmason dev`
 * remote (docs/SPEC.md §4).
 *
 * SPEC §4 says `gridmason dev` "serves the remote locally" and the dashboard
 * "hot-loads it", but does not pin the *serving contract* (the URL shape / how
 * the dashboard learns the widget's tag + entry). Pending that (gridmason/cli#28)
 * this is the **SPEC-literal stand-in contract** the dashboard registers against
 * — a small JSON descriptor served at {@link DEV_WIDGET_MANIFEST_PATH} next to
 * the ES-module entry:
 *
 * ```json
 * { "tag": "acme-dev-note", "name": "Field Notes", "entry": "/entry.js" }
 * ```
 *
 * The dashboard fetches it from the registered origin, learns the custom-element
 * `tag` to place and the `entry` module to `import()`, and admits the remote. If
 * the real `gridmason dev` serves a different shape, only this module changes;
 * the allowlist, mount, badge, and CSP paths are contract-agnostic. Parsing is
 * pure and total so it is unit-testable without a network.
 */
import type { DevSideloadRegistration } from './allowlist-store';

/** Well-known path the dev server serves its widget descriptor at (stand-in contract). */
export const DEV_WIDGET_MANIFEST_PATH = '/gridmason.widget.json';

/** The descriptor a dev server serves so the dashboard can admit its widget. */
export interface DevWidgetManifest {
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

/**
 * Validate a fetched descriptor for dev-server `origin` and resolve its `entry`
 * to an absolute URL on that origin. Returns a {@link DevSideloadRegistration}
 * ready for the allowlist, or a human error. Total — never throws — so a
 * malformed dev manifest surfaces as a rejected registration, not a crash.
 */
export function parseDevWidgetManifest(value: unknown, origin: string): ParsedManifest {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'dev widget manifest is not a JSON object' };
  }
  const record = value as Record<string, unknown>;
  const tag = asString(record.tag);
  const name = asString(record.name);
  const entry = asString(record.entry);
  if (tag === undefined) return { ok: false, error: 'manifest is missing a "tag"' };
  if (!CUSTOM_ELEMENT_NAME.test(tag)) {
    return { ok: false, error: `"${tag}" is not a valid custom-element tag` };
  }
  if (entry === undefined) return { ok: false, error: 'manifest is missing an "entry"' };

  let entryUrl: string;
  try {
    // Resolve `entry` against the origin: a path (`/entry.js`) becomes absolute on
    // the dev server; an absolute URL is kept only if it stays on the same origin
    // (a dev remote serves its own code — no redirect to a third origin).
    const resolved = new URL(entry, ensureTrailingSlash(origin));
    if (resolved.origin !== new URL(origin).origin) {
      return { ok: false, error: 'manifest "entry" points off the dev-server origin' };
    }
    entryUrl = resolved.href;
  } catch {
    return { ok: false, error: `manifest "entry" is not a resolvable URL: ${entry}` };
  }

  return {
    ok: true,
    registration: { origin: normalizeOrigin(origin), entryUrl, tag, name: name ?? tag },
  };
}

/** Normalize a user-entered origin to its canonical `scheme://host[:port]` form. */
export function normalizeOrigin(origin: string): string {
  return new URL(origin).origin;
}

function ensureTrailingSlash(origin: string): string {
  return origin.endsWith('/') ? origin : `${origin}/`;
}

/**
 * Fetch and validate the dev-server widget descriptor for `origin`. Rejects with
 * a human message on a network error or an invalid manifest, so the dev UI can
 * show the owner why a registration failed. `fetchImpl` is injectable for tests.
 */
export async function fetchDevWidgetManifest(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DevSideloadRegistration> {
  const manifestUrl = new URL(DEV_WIDGET_MANIFEST_PATH, ensureTrailingSlash(origin)).href;
  let response: Response;
  try {
    response = await fetchImpl(manifestUrl);
  } catch (cause) {
    throw new Error(`could not reach dev server at ${origin}`, { cause });
  }
  if (!response.ok) {
    throw new Error(`dev server returned ${response.status} for ${DEV_WIDGET_MANIFEST_PATH}`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = parseDevWidgetManifest(body, origin);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.registration;
}
