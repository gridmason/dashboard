/**
 * The deployment's **federated-boot configuration** (docs/SPEC.md §2, §5; FR-10;
 * GW-D21) — everything the lazy verified-mount path (#16) needs beyond #15's gate
 * config to resolve, verify, and mount a registry's remotes.
 *
 * ```
 * gate config (../boot/gate-snapshot)         ← which remotes are enabled
 *   + resolveEndpoint  ← where to POST /v1/resolve (registry SPEC §8)
 *   + servingOrigin    ← the hash-addressed artifact origin (registry docs/serving.md)
 *   + trust material   ← the operator's out-of-band pins/roots/keys for verifyRelease
 * ```
 *
 * **Single-registry (registry SPEC §9).** A gate snapshot targets exactly one
 * registry (a host pins each publisher prefix to one registry), so this config is
 * single-registry too: one resolution endpoint, one serving origin, one trust set.
 * A deployment that federates against several registries carries one of these per
 * registry and merges the assembled maps (../boot/import-map-assembly already
 * supports the multi-fragment merge; #16 wires one).
 *
 * **Config-file driven, out-of-band trust (GW-D21, SPEC §4.4/§5).** Pre-1.0 there
 * is one tenant and one config file. The **trust material** here — the pinned
 * publisher-CA and countersign roots, the log checkpoint key, and the trust-root
 * pins — is the operator's *out-of-band* trusted input to `verifyRelease`: it is
 * what makes a network-delivered trust-root document believable, and it never
 * arrives over the resolution API. This module carries it as an opaque bundle it
 * hands `verifyRelease` untouched (../boot/release-verification); it interprets no
 * key and trusts nothing for being in the config — the pins are re-checked by the
 * verify lib on every release.
 *
 * **Fails loud.** A structurally invalid federated config throws
 * {@link FederatedConfigError} rather than sending a malformed snapshot or handing
 * `verifyRelease` a half-populated trust set — the same posture as the gate config
 * loader (../boot/gate-snapshot). Enablement validity is the gate config's concern
 * (validated when the snapshot is built); this validates the resolution/serving/
 * trust envelope around it.
 */
import type { LogPublicKey, TrustRootPin } from '@gridmason/protocol/verify';
import type { DeploymentGateConfig } from './gate-snapshot';

/**
 * The operator's **out-of-band trust material** for `verifyRelease` — the pinned
 * roots, keys, and trust-root document that authorize a registry's signed releases
 * (SPEC §4.4, §5). These are the inputs `verifyRelease` treats as trusted (supplied
 * by the operator, not the network); the per-module signature bundle it verifies
 * against them rides the resolution fragment. Held opaque here: #16 passes each
 * field straight through to the verify lib and interprets none of it.
 */
export interface FederatedTrustConfig {
  /** The (untrusted, network-or-config-delivered) trust-root document, gated by {@link pins}. */
  readonly trustRoot: unknown;
  /** The operator's out-of-band pins that authorize the trust-root document. */
  readonly pins: readonly TrustRootPin[];
  /** Pinned publisher CA root public keys (SPKI DER) that may issue publisher leaf certs. */
  readonly publisherCARoots: readonly Uint8Array[];
  /** Pinned registry countersign root public keys (SPKI DER); also the rotation cross-signers. */
  readonly countersignRoots: readonly Uint8Array[];
  /** The pinned transparency-log checkpoint key (GW-D17) inclusion proofs are checked against. */
  readonly logPublicKey: LogPublicKey;
}

/**
 * The deployment's federated config for **one** registry: the gate config (which
 * remotes are enabled, ../boot/gate-snapshot), the registry's resolution endpoint
 * and hash-addressed serving origin, and the trust material the resolved releases
 * are verified against.
 */
export interface FederatedRegistryConfig {
  /**
   * The gate config: the registry id, the enabled `(publisher, tag, version)`
   * remotes, and the shared-dep majors the shell offers. Its `registry` is the id
   * the resolver requires the snapshot to name; validity of its enablement is
   * checked when the snapshot is built (../boot/gate-snapshot).
   */
  readonly gate: DeploymentGateConfig;
  /**
   * The absolute `POST /v1/resolve` endpoint of this registry's resolution API
   * (e.g. `https://registry.gridmason.dev/v1/resolve`). The resolution surface is
   * separate from the serving surface below (registry docs/serving.md).
   */
  readonly resolveEndpoint: string;
  /**
   * The absolute `GET /v1/revocation/feed` URL of this registry's signed revocation
   * & kill feed (registry SPEC §6). The federated boot consumes it before assembling
   * the map so a revoked/killed remote never enters it (SPEC §2, FR-12); a feed that
   * is stale, unreachable, unverifiable, or absent fails **this registry** closed.
   */
  readonly feedUrl: string;
  /**
   * The absolute hash-addressed serving origin this registry's artifacts are
   * pinned to (e.g. `https://cdn.gridmason.dev`). The fragment's root-relative
   * `/v1/artifacts/:hash` URLs are composed against it into the absolute URLs the
   * import map and the D-E4 Service Worker use.
   */
  readonly servingOrigin: string;
  /** The out-of-band trust material every resolved release is verified against. */
  readonly trust: FederatedTrustConfig;
}

/**
 * Thrown when a federated registry config is structurally invalid — fails the boot
 * loudly rather than resolving against a malformed endpoint or verifying against a
 * half-populated trust set.
 */
export class FederatedConfigError extends Error {
  override readonly name = 'FederatedConfigError';
  constructor(detail: string) {
    super(`Invalid federated registry config: ${detail}`);
  }
}

/**
 * Validate a {@link FederatedRegistryConfig}'s resolution/serving/trust envelope,
 * throwing {@link FederatedConfigError} on the first fault. The gate config's own
 * enablement is validated separately when its snapshot is built
 * (../boot/gate-snapshot `buildGateSnapshot`), so this checks the fields #16 adds:
 * the two absolute URLs and that the trust material is present and well-shaped.
 */
export function validateFederatedRegistryConfig(config: FederatedRegistryConfig): void {
  if (config.gate === null || typeof config.gate !== 'object') {
    throw new FederatedConfigError('`gate` must be a gate config object');
  }
  requireAbsoluteUrl(config.resolveEndpoint, 'resolveEndpoint');
  requireAbsoluteUrl(config.servingOrigin, 'servingOrigin');
  requireAbsoluteUrl(config.feedUrl, 'feedUrl');
  validateTrust(config.trust);
}

/** A field must be a non-empty, absolute `http(s)` URL (the resolver/serving pins are absolute). */
function requireAbsoluteUrl(value: unknown, field: string): void {
  if (typeof value !== 'string' || value === '') {
    throw new FederatedConfigError(`\`${field}\` must be a non-empty string`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FederatedConfigError(`\`${field}\` must be an absolute URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FederatedConfigError(`\`${field}\` must be an http(s) URL`);
  }
}

/**
 * Validate the trust material is present and each field is the right *kind* — the
 * verify lib re-checks every value cryptographically, so this only rejects a
 * structurally missing/mistyped bundle (which would otherwise reach `verifyRelease`
 * as a silent no-trust set and refuse every release with an opaque reason).
 */
function validateTrust(trust: FederatedTrustConfig): void {
  if (trust === null || typeof trust !== 'object') {
    throw new FederatedConfigError('`trust` must be a trust-config object');
  }
  if (!('trustRoot' in trust)) {
    throw new FederatedConfigError('`trust.trustRoot` is required');
  }
  requireArray(trust.pins, 'trust.pins');
  requireKeyArray(trust.publisherCARoots, 'trust.publisherCARoots');
  requireKeyArray(trust.countersignRoots, 'trust.countersignRoots');
  if (trust.logPublicKey === null || typeof trust.logPublicKey !== 'object') {
    throw new FederatedConfigError('`trust.logPublicKey` must be a log public key');
  }
}

function requireArray(value: unknown, field: string): void {
  if (!Array.isArray(value)) {
    throw new FederatedConfigError(`\`${field}\` must be an array`);
  }
}

/** A pinned-root array must be present and hold only `Uint8Array` SPKI-DER keys. */
function requireKeyArray(value: unknown, field: string): void {
  requireArray(value, field);
  (value as readonly unknown[]).forEach((key, i) => {
    if (!(key instanceof Uint8Array)) {
      throw new FederatedConfigError(`\`${field}[${i}]\` must be a Uint8Array (SPKI DER key)`);
    }
  });
}
