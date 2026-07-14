/**
 * The **acknowledged-sideload registration** store (FR-8, SPEC §4): the persistent
 * home for the owner-acknowledged, URL-registered, hash-pinned sideloaded remotes
 * a *deployed* dashboard is allowed to load. It is the third store alongside the
 * layout KV ({@link LayoutStore}) and the org-publication store
 * ({@link GovernanceStore}), and — unlike the `dev` sideload allowlist, which is
 * client-side session state that persists nothing — this is durable server state:
 * a registration survives a reload and a restart (SPEC §4: `acknowledged` adds
 * **persistent** remotes, "recorded in config").
 *
 * A registration is exactly the spec's data-model row — `{ url, hash,
 * acknowledgedBy, at }` (docs/specs/dashboard-v0/spec.md §data-model) — plus the
 * `origin` the URL resolves to, which the CSP layer reads to know which origins an
 * explicit owner action added to `script-src`. Only an **http(s) URL** may be
 * registered: inline / `data:` / `base64` code is refused up front
 * ({@link parseRegistrationInput}), so unreviewed code always arrives by URL and
 * can be hash-pinned and re-fetched, never smuggled inline (SPEC §4).
 *
 * Storage mirrors its siblings: in-memory with optional JSON file backing (v0 — no
 * database), deep-cloned in and out so a caller can never mutate stored state
 * through a shared reference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SideloadMode } from '../config/index';

/**
 * One acknowledged-sideload registration. `url` is the registered remote (its
 * widget-descriptor URL); `origin` is that URL's origin (the source a placed
 * instance's `sideload:<origin>` identity keys on, and the entry the CSP layer
 * adds to `script-src`); `hash` is the content hash the remote's entry module was
 * **pinned** to at registration (SRI `sha256-<base64>`); `acknowledgedBy` + `at`
 * record who accepted the unreviewed-code risk, and when (SPEC §4 + FR-8).
 */
export interface SideloadRegistration {
  /** The registered remote's widget-descriptor URL (http/https only). */
  readonly url: string;
  /** The origin `url` resolves to — the `sideload:<origin>` source + the CSP `script-src` entry. */
  readonly origin: string;
  /** The entry module's content hash pinned at registration (SRI `sha256-<base64>`). */
  readonly hash: string;
  /** The owner who acknowledged the unreviewed-code risk (a user id). */
  readonly acknowledgedBy: string;
  /** ISO-8601 timestamp the registration was recorded. */
  readonly at: string;
}

/** The fields a caller supplies to register; the store derives `origin` + `at`. */
export interface SideloadRegistrationInput {
  readonly url: string;
  readonly hash: string;
  readonly acknowledgedBy: string;
}

/** On-disk serialization: a flat list of registrations. */
interface SideloadFile {
  readonly version: 1;
  readonly registrations: readonly SideloadRegistration[];
}

/**
 * The result of validating a registration request body: a normalized registration
 * (minus the store-assigned `at`), or a human reason it was rejected. Total —
 * never throws — so a malformed request is a 400 with a message, not a crash.
 */
export type ParsedRegistration =
  | { readonly ok: true; readonly value: Omit<SideloadRegistration, 'at'> }
  | { readonly ok: false; readonly error: string };

/** SRI content-hash shape the pin must take (`sha256-<base64>`), the format the load path verifies against. */
const SRI_SHA256 = /^sha256-[A-Za-z0-9+/]+={0,2}$/;

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Validate a registration request body (FR-8). Enforces the two invariants the
 * spec makes load-bearing: the code is registered **by URL** — an `http:`/`https:`
 * URL, never inline/`data:`/`base64`/`javascript:` — and the pin is a well-formed
 * SRI `sha256` hash. Returns the normalized registration (canonical `url` +
 * derived `origin`) or a rejection message. `acknowledgedBy` is required — a
 * registration cannot exist without the owner acknowledgement that unlocks it.
 */
export function parseRegistrationInput(value: unknown): ParsedRegistration {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'registration must be a JSON object' };
  }
  const record = value as Record<string, unknown>;
  const rawUrl = asNonEmptyString(record.url);
  const hash = asNonEmptyString(record.hash);
  const acknowledgedBy = asNonEmptyString(record.acknowledgedBy);

  if (rawUrl === undefined) return { ok: false, error: 'registration is missing a "url"' };
  if (hash === undefined) return { ok: false, error: 'registration is missing a "hash"' };
  if (acknowledgedBy === undefined) {
    return { ok: false, error: 'registration is missing "acknowledgedBy" (the owner acknowledgement)' };
  }
  if (!SRI_SHA256.test(hash)) {
    return { ok: false, error: 'registration "hash" must be an SRI sha256 pin (sha256-<base64>)' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: `registration "url" is not a valid URL: ${rawUrl}` };
  }
  // URL-only: unreviewed code must arrive at a fetchable, hash-pinnable http(s)
  // URL — never inline (`data:`), never a script pseudo-URL (`javascript:`),
  // never `blob:`/`file:` (SPEC §4: "registered by URL (never inline/base64 code)").
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `registration "url" must be an http(s) URL, not ${parsed.protocol} (inline/base64 code is refused)`,
    };
  }

  return { ok: true, value: { url: parsed.href, origin: parsed.origin, hash, acknowledgedBy } };
}

/**
 * The acknowledged origins the deployment's CSP may add to `script-src`, given the
 * configured sideload `mode` (SPEC §4). This is the server-side, config-recorded
 * authority the enforced production CSP reads (M3 hardening, SPEC §7/§9): **empty**
 * unless the posture is explicitly `acknowledged`, so with the default `off` — or
 * `dev`, whose relaxation is delivered separately and dev-only — no acknowledged
 * origin is ever permitted and the production CSP is never relaxed. Origins are
 * de-duplicated; a registration list only ever adds its own origins, never `'self'`
 * or a wildcard.
 */
export function acknowledgedScriptSrc(
  mode: SideloadMode,
  registrations: readonly SideloadRegistration[],
): readonly string[] {
  if (mode !== 'acknowledged') return [];
  return [...new Set(registrations.map((registration) => registration.origin))];
}

export class SideloadRegistrationStore {
  /** Keyed by canonical `url` so re-registering the same remote replaces its pin. */
  readonly #byUrl = new Map<string, SideloadRegistration>();
  readonly #filePath: string | undefined;

  constructor(options: { readonly filePath?: string } = {}) {
    this.#filePath = options.filePath;
    if (this.#filePath !== undefined) {
      this.#load(this.#filePath);
    }
  }

  /** Every registration, deep-copied — the config-visible list of acknowledged origins. */
  list(): readonly SideloadRegistration[] {
    return [...this.#byUrl.values()].map((r) => ({ ...r }));
  }

  /** The registration for `url`, or `undefined`. Returns a copy. */
  get(url: string): SideloadRegistration | undefined {
    const entry = this.#byUrl.get(url);
    return entry === undefined ? undefined : { ...entry };
  }

  /**
   * Record (or replace) a registration, stamping `at` with the current time.
   * `input` must already be validated ({@link parseRegistrationInput}); this only
   * assigns the timestamp and persists. Returns the stored registration.
   */
  put(input: Omit<SideloadRegistration, 'at'>, now: Date = new Date()): SideloadRegistration {
    const registration: SideloadRegistration = { ...input, at: now.toISOString() };
    this.#byUrl.set(registration.url, registration);
    this.#persist();
    return { ...registration };
  }

  /** Remove the registration for `url`. Returns whether one was present. */
  delete(url: string): boolean {
    const existed = this.#byUrl.delete(url);
    if (existed) this.#persist();
    return existed;
  }

  /** Number of registrations. */
  get size(): number {
    return this.#byUrl.size;
  }

  #load(filePath: string): void {
    if (!existsSync(filePath)) return;
    let parsed: SideloadFile;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as SideloadFile;
    } catch (cause) {
      throw new Error(`Corrupt sideload store file (${filePath}): ${(cause as Error).message}`);
    }
    for (const registration of parsed.registrations ?? []) {
      this.#byUrl.set(registration.url, registration);
    }
  }

  #persist(): void {
    if (this.#filePath === undefined) return;
    const file: SideloadFile = { version: 1, registrations: [...this.#byUrl.values()] };
    mkdirSync(dirname(this.#filePath), { recursive: true });
    writeFileSync(this.#filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}
