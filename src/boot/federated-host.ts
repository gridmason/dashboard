/**
 * The **federated-boot seam** the canvas render path consults (docs/SPEC.md §2;
 * FR-10) — the prod-safe holder that lets `CanvasHost` merge verified federated
 * remotes into its import map without statically importing the boot pipeline (the
 * resolution client, verify plumbing, and provider) onto the render path.
 *
 * It mirrors the acknowledged-sideload seam (../sideload/host-seam): the
 * {@link FederatedBootProvider} runs the async boot once, then **installs** a
 * {@link FederatedHost} here; `CanvasHost` reads it back to (a) merge each verified
 * remote (carrying its verified-URL `load` thunk, ../boot/federated-remote) into the
 * active import map, and (b) resolve a display name for a federated widget's
 * fallback card. Federated boot is core Phase-B functionality (not dev-only), so —
 * like the acknowledged seam and unlike the dev one — this is consulted on **every**
 * build, not behind an `import.meta.env.DEV` guard.
 *
 * When no registry is configured (the default showcase state) the provider installs
 * nothing and `federatedHost()` stays `null`, so the render path sees no federated
 * remote and behaves exactly as Phase A.
 */
import type { WidgetID } from '@gridmason/protocol';
import type { LocalRemote } from './import-map';

/** What the federated-boot provider exposes to the canvas render path. */
export interface FederatedHost {
  /** The verified federated remotes, as import-map entries to merge with the local map. */
  remotes(): readonly LocalRemote[];
  /** A display name for a verified federated widget identity (its card name), or `undefined`. */
  describe(id: WidgetID): string | undefined;
}

let installed: FederatedHost | null = null;

/** Install (or clear, with `null`) the federated-boot host. Called only by the provider. */
export function installFederatedHost(host: FederatedHost | null): void {
  installed = host;
}

/** The installed federated-boot host, or `null` when no registry is federated. */
export function federatedHost(): FederatedHost | null {
  return installed;
}
