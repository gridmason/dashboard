/**
 * Turn an acknowledged-sideload registration into a **hash-verifying**
 * {@link LocalRemote} the boot import map can carry (docs/SPEC.md §4, FR-8).
 *
 * Unlike a `dev` remote — re-served live and never pinned ({@link sideloadRemote})
 * — an acknowledged remote is **pinned to a content hash at registration**, and its
 * pin is checked **before** its module is allowed to register a custom element. So
 * its `load` thunk is not a bare `import()`: it fetches the entry bytes, recomputes
 * their SRI hash, and only imports when the hash matches the pin. A **mismatch
 * refuses the load** — it emits `sideload.hash_mismatch` telemetry and throws, so
 * the widget never mounts (its slot falls to the error-boundary card) rather than
 * running unverified code (FR-8 acceptance).
 *
 * **Phase-A honesty note (FR-8):** the check is fetch-then-verify-then-import, so a
 * remote that serves different bytes to the verify fetch and the import fetch has a
 * TOCTOU window. There is **no verification chain yet** — this pins content to an
 * owner-recorded hash, not a signed, logged release. The Phase-B Service-Worker
 * path (FR-11) closes the window by buffering, verifying, and serving the exact
 * bytes. Run only widgets you built or reviewed.
 *
 * This module is **prod-safe**: acknowledged sideload, unlike `dev`, is available in
 * production builds (SPEC §4), so nothing here is gated on `import.meta.env.DEV`.
 */
import type { LocalRemote } from '../boot/import-map';
import type { AcknowledgedRemote } from './acknowledged-store';
import { matchesPin, sha256Pin } from './hash';
import { consoleSideloadTelemetry, type SideloadTelemetry } from './telemetry';

/** Raised when an acknowledged remote's fetched content does not match its pin. */
export class HashPinMismatchError extends Error {
  override readonly name = 'HashPinMismatchError';
  constructor(readonly url: string) {
    super(`acknowledged sideload refused: ${url} does not match its pinned hash`);
  }
}

/** Injectable collaborators for {@link acknowledgedRemote} — defaulted for production, overridden in tests. */
export interface AcknowledgedRemoteDeps {
  /** `fetch` used to pull the entry bytes for verification. Defaults to the global. */
  readonly fetchImpl?: typeof fetch;
  /** Telemetry sink for a refused load. Defaults to the console exporter. */
  readonly telemetry?: SideloadTelemetry;
  /**
   * How a verified entry URL is imported (registering its custom element).
   * Defaults to a native dynamic `import()`; injectable so a test can assert the
   * module is imported **only** after a successful verification.
   */
  readonly importModule?: (entryUrl: string) => Promise<unknown>;
}

/** Build the hash-verifying import-map entry for one acknowledged remote. */
export function acknowledgedRemote(
  remote: AcknowledgedRemote,
  deps: AcknowledgedRemoteDeps = {},
): LocalRemote {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const telemetry = deps.telemetry ?? consoleSideloadTelemetry;
  const importModule =
    deps.importModule ?? ((entryUrl: string) => import(/* @vite-ignore */ entryUrl));

  return {
    tag: remote.tag,
    source: remote.widgetID.source,
    name: remote.name,
    specifier: `${remote.widgetID.source}/${remote.tag}`,
    load: async () => {
      // Fetch the entry bytes and verify them against the pin before importing.
      const response = await fetchImpl(remote.entryUrl);
      if (!response.ok) {
        throw new Error(`acknowledged sideload: ${remote.entryUrl} returned ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      if (!(await matchesPin(bytes, remote.hash))) {
        telemetry({
          type: 'sideload.hash_mismatch',
          url: remote.url,
          expected: remote.hash,
          // Recompute the actual hash for the telemetry record (best-effort).
          actual: await sha256Pin(bytes).catch(() => 'unknown'),
        });
        throw new HashPinMismatchError(remote.url);
      }
      return importModule(remote.entryUrl);
    },
  };
}
