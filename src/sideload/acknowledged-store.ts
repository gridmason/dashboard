/**
 * The client half of acknowledged sideload (docs/SPEC.md §4, FR-8): the API-backed
 * adapter that reads and writes the **persistent** acknowledged-remote registrations
 * the demo API stores, and resolves each into a mountable {@link AcknowledgedRemote}.
 *
 * This is the persisted sibling the dev-sideload allowlist's extension note pointed
 * at ({@link DevSideloadAllowlist} — "a persisted backing (config-recorded)"): where
 * `dev` mode keeps a memory-only, per-session allowlist, `acknowledged` mode keeps
 * its registrations server-side (`{ url, hash, acknowledgedBy, at }`), so they
 * survive a reload. Registering pins the entry module's content hash **at
 * registration time**: this adapter fetches the remote's manifest and entry, hashes
 * the entry ({@link sha256Pin}), and records the pin — the value the load path later
 * verifies against ({@link acknowledgedRemote}).
 *
 * **Prod-safe** (SPEC §4: acknowledged mode is available in production builds), so
 * nothing here is gated on `import.meta.env.DEV`. It reuses the shared widget
 * descriptor contract ({@link fetchWidgetManifest}) to learn a remote's tag + entry.
 */
import type { WidgetID } from '@gridmason/protocol';
import { fetchDevWidgetManifest, normalizeOrigin } from './manifest';
import { sideloadSource } from './source';
import { sha256Pin } from './hash';

/** A persisted acknowledged-sideload registration (mirrors the demo API's shape). */
export interface SideloadRegistration {
  readonly url: string;
  readonly origin: string;
  readonly hash: string;
  readonly acknowledgedBy: string;
  readonly at: string;
}

/**
 * A registration resolved into everything the import map + badge need: the manifest
 * fields (`entryUrl`, `tag`, `name`), the `sideload:<origin>` identity every placed
 * instance keys on, and the persisted pin/acknowledgement metadata carried through.
 */
export interface AcknowledgedRemote {
  /** The registered remote URL (its widget-descriptor base). */
  readonly url: string;
  /** The origin `url` resolves to — the `sideload:<origin>` source + CSP `script-src` entry. */
  readonly origin: string;
  /** Absolute URL of the ES-module entry to verify + import. */
  readonly entryUrl: string;
  /** The custom-element tag the entry defines. */
  readonly tag: string;
  /** Human display name for the card + picker entry. */
  readonly name: string;
  /** The SRI content pin the entry is verified against before it mounts. */
  readonly hash: string;
  /** The owner who acknowledged the unreviewed-code risk. */
  readonly acknowledgedBy: string;
  /** When the registration was recorded (ISO-8601). */
  readonly at: string;
  /** The `sideload:<origin>` identity every placed instance + badge keys on. */
  readonly widgetID: WidgetID;
}

/** Options for {@link ApiAcknowledgedSideload}. */
export interface ApiAcknowledgedSideloadOptions {
  /** Base URL the `/api/...` paths resolve against. Defaults to `''` (same-origin). */
  readonly baseUrl?: string;
  /** Injectable `fetch`, for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Raised when the sideload API answers with an unexpected status. */
export class AcknowledgedSideloadError extends Error {
  override readonly name = 'AcknowledgedSideloadError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The API-backed acknowledged-sideload registrations adapter. Reads the persisted
 * registrations and resolves them into mountable remotes; registers a new remote by
 * URL (pinning its content hash at registration) and deregisters one. Mutations are
 * owner-gated server-side (the API answers a non-owner `403`).
 */
export class ApiAcknowledgedSideload {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: ApiAcknowledgedSideloadOptions = {}) {
    this.#baseUrl = options.baseUrl ?? '';
    this.#fetch = (options.fetch ?? globalThis.fetch).bind(globalThis);
  }

  /** The raw persisted registrations (config-visible list). */
  async list(): Promise<readonly SideloadRegistration[]> {
    const res = await this.#fetch(`${this.#baseUrl}/api/sideload`, { credentials: 'include' });
    if (!res.ok) throw new AcknowledgedSideloadError(res.status, `sideload GET failed (${res.status})`);
    return ((await res.json()) as { registrations: SideloadRegistration[] }).registrations;
  }

  /**
   * Resolve every registration into a mountable {@link AcknowledgedRemote} by
   * fetching each remote's widget descriptor (tag + entry). A registration whose
   * descriptor cannot be resolved right now is **skipped** rather than failing the
   * whole set — one unreachable remote never blocks the others (SPEC §7).
   */
  async resolveRemotes(): Promise<readonly AcknowledgedRemote[]> {
    const registrations = await this.list();
    const resolved = await Promise.all(
      registrations.map((registration) => this.#resolve(registration).catch(() => undefined)),
    );
    return resolved.filter((remote): remote is AcknowledgedRemote => remote !== undefined);
  }

  async #resolve(registration: SideloadRegistration): Promise<AcknowledgedRemote> {
    const manifest = await fetchDevWidgetManifest(registration.url, this.#fetch);
    return {
      url: registration.url,
      origin: registration.origin,
      entryUrl: manifest.entryUrl,
      tag: manifest.tag,
      name: manifest.name,
      hash: registration.hash,
      acknowledgedBy: registration.acknowledgedBy,
      at: registration.at,
      widgetID: { source: sideloadSource(registration.origin), tag: manifest.tag },
    };
  }

  /**
   * Register a remote by URL, pinning its entry's content hash **now** (SPEC §4:
   * "hash-pinned at registration time"). Fetches the descriptor to find the entry,
   * fetches the entry to hash it, then records `{ url, hash }` (the server stamps
   * `acknowledgedBy` from the session and `at`). Rejects with a human message on a
   * bad URL, an unreachable remote, or a `403` (not an owner).
   */
  async register(url: string): Promise<SideloadRegistration> {
    const manifest = await fetchDevWidgetManifest(url, this.#fetch);
    const entryResponse = await this.#fetch(manifest.entryUrl);
    if (!entryResponse.ok) {
      throw new AcknowledgedSideloadError(
        entryResponse.status,
        `could not fetch entry ${manifest.entryUrl} to pin (${entryResponse.status})`,
      );
    }
    const hash = await sha256Pin(await entryResponse.arrayBuffer());

    const res = await this.#fetch(`${this.#baseUrl}/api/sideload`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: normalizeOrigin(url), hash }),
    });
    if (!res.ok) {
      throw new AcknowledgedSideloadError(res.status, `sideload registration failed (${res.status})`);
    }
    return ((await res.json()) as { registration: SideloadRegistration }).registration;
  }

  /** Deregister the remote registered at `url`. Resolves `true` if one was present. */
  async remove(url: string): Promise<boolean> {
    const res = await this.#fetch(
      `${this.#baseUrl}/api/sideload?url=${encodeURIComponent(url)}`,
      { method: 'DELETE', credentials: 'include' },
    );
    if (res.status === 204) return true;
    if (res.status === 404) return false;
    throw new AcknowledgedSideloadError(res.status, `sideload deregistration failed (${res.status})`);
  }
}
