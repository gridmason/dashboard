/**
 * The **federated-config loader** (docs/SPEC.md §2, §4.4; FR-10; GW-D21) — fetches
 * the deployment's {@link FederatedRegistryConfig} so a real deployment can connect
 * a registry, replacing the permanent `null` stub. Absent config → `null` → boot
 * stays inert, exactly the showcase default.
 *
 * ## Where the config comes from — and why that is safe (SPEC §4.4)
 *
 * The config is served by the **deployment**, from the app's **own origin**, at
 * `<base>/federated.json`. That is deliberate and load-bearing for trust.
 *
 * `verifyRelease` never trusts a trust-root document fetched blind from the
 * network: it believes one only when it matches an **out-of-band pin** the operator
 * supplied through one of SPEC §4.4's two "never-fetch-blind-at-runtime" channels —
 * the **build-time** channel (pins shipped in the host bundle) or the **deploy-time**
 * channel (pins supplied as deploy config/secret). This loader is the deploy-time
 * channel: `federated.json` is the deployment operator's own config file, served
 * from the same origin as the app bundle the same operator built and deployed. The
 * pins in it therefore come from the deployment, **not** from the registry being
 * authorized and **not** over the registry's resolution API — which is exactly the
 * threat §4.4 defends against (a registry must not be able to supply the pins that
 * authorize its own releases). An attacker who controls the registry cannot alter a
 * file on the app's origin, so co-locating the pins with the app is the strongest
 * posture, not a weaker one. (The trust-root **document** itself may travel over any
 * channel — it is cryptographically gated by these pins — but here it is baked into
 * the same deploy config for simplicity; the pins remain deploy-time material either
 * way.)
 *
 * Because the config is same-origin, fetching it needs no CSP change (`connect-src
 * 'self'` already permits it). Actually *federating* — resolving/serving/feed calls
 * to the registry's cross-origin endpoints — does, and is documented separately
 * (docs/csp.md "Federating a registry"); this loader only reads the same-origin file.
 *
 * ## Encoding
 *
 * `federated.json` is JSON, so the trust material's binary fields are **base64**:
 * `trust.publisherCARoots` / `trust.countersignRoots` (SPKI-DER public keys) and
 * `trust.logPublicKey.key` (the 32-byte Ed25519 checkpoint key). This loader decodes
 * them to `Uint8Array` before validation; every other field is JSON-native and passes
 * through untouched (and unread — the trust material stays opaque, re-checked
 * cryptographically by `verifyRelease` on every release).
 *
 * ## Failure posture
 *
 * - **Absent** (`404`) or **unreachable** (network/CORS error, non-2xx): `null` —
 *   federation stays inert, the shell renders its local widgets. This is the default
 *   showcase (no `federated.json` served) and offline.
 * - **Served but malformed** (non-JSON, bad base64, missing/mistyped fields, a
 *   non-absolute endpoint): throws {@link FederatedConfigError}. A misconfigured
 *   deployment fails **loud** (the provider surfaces it as a banner), never silently
 *   inert — that silence is the bug this issue was found chasing.
 */
import type { LogPublicKey, TrustRootPin } from '@gridmason/protocol/verify';
import {
  FederatedConfigError,
  validateFederatedRegistryConfig,
  type FederatedRegistryConfig,
  type FederatedTrustConfig,
} from './federated-config';
import type { DeploymentGateConfig } from './gate-snapshot';

/** The path, relative to the app's base, the deployment serves its config at. */
export const FEDERATED_CONFIG_PATH = 'federated.json';

/**
 * The JSON (wire) form of {@link FederatedTrustConfig}: identical to the in-memory
 * shape except the binary fields are **base64** strings (JSON has no bytes).
 */
export interface FederatedTrustConfigWire {
  /** The trust-root document (SPEC §4.4), gated by {@link pins}. JSON object, passed through. */
  readonly trustRoot: unknown;
  /** The operator's out-of-band pins authorizing the trust-root document. JSON-native. */
  readonly pins: readonly TrustRootPin[];
  /** Pinned publisher CA roots — **base64** SPKI DER. */
  readonly publisherCARoots: readonly string[];
  /** Pinned registry countersign roots — **base64** SPKI DER. */
  readonly countersignRoots: readonly string[];
  /** The pinned transparency-log checkpoint key: name + **base64** 32-byte Ed25519 key. */
  readonly logPublicKey: { readonly name: string; readonly key: string };
}

/** The JSON (wire) form of {@link FederatedRegistryConfig} — `trust` is the base64 {@link FederatedTrustConfigWire}. */
export interface FederatedRegistryConfigWire {
  readonly gate: DeploymentGateConfig;
  readonly resolveEndpoint: string;
  readonly feedUrl: string;
  readonly servingOrigin: string;
  readonly trust: FederatedTrustConfigWire;
}

/** Injectable collaborators, for tests. */
export interface LoadFederatedConfigDeps {
  /** `fetch` to use. Defaults to the global. */
  readonly fetch?: typeof globalThis.fetch;
  /** The app base path the config is resolved against. Defaults to `import.meta.env.BASE_URL`. */
  readonly base?: string;
}

/** Narrow an untrusted value to a plain object, or fail loud. */
function asObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FederatedConfigError(`\`${field}\` must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Decode one base64 field to bytes, failing loud with the field name on a bad value. */
function decodeBase64(value: unknown, field: string): Uint8Array {
  if (typeof value !== 'string') {
    throw new FederatedConfigError(`\`${field}\` must be a base64 string`);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new FederatedConfigError(`\`${field}\` is not valid base64`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decode a base64 string array (SPKI-DER key list) to `Uint8Array[]`, failing loud. */
function decodeBase64Array(value: unknown, field: string): Uint8Array[] {
  if (!Array.isArray(value)) {
    throw new FederatedConfigError(`\`${field}\` must be an array of base64 strings`);
  }
  return value.map((entry, i) => decodeBase64(entry, `${field}[${i}]`));
}

/**
 * Convert the JSON wire config into the in-memory {@link FederatedRegistryConfig},
 * decoding the base64 binary trust fields to bytes. Non-binary fields pass through
 * untouched; {@link validateFederatedRegistryConfig} (run by the loader afterward)
 * validates the resolution/serving/trust envelope. Throws {@link FederatedConfigError}
 * on a structurally broken wire object so a bad config never reaches `verifyRelease`
 * as a half-populated trust set.
 */
export function decodeFederatedConfig(wire: unknown): FederatedRegistryConfig {
  const root = asObject(wire, 'federated config');
  const trustWire = asObject(root.trust, 'trust');
  if (!('trustRoot' in trustWire)) {
    throw new FederatedConfigError('`trust.trustRoot` is required');
  }
  const logKey = asObject(trustWire.logPublicKey, 'trust.logPublicKey');
  if (typeof logKey.name !== 'string') {
    throw new FederatedConfigError('`trust.logPublicKey.name` must be a string');
  }
  const trust: FederatedTrustConfig = {
    trustRoot: trustWire.trustRoot,
    pins: trustWire.pins as readonly TrustRootPin[],
    publisherCARoots: decodeBase64Array(trustWire.publisherCARoots, 'trust.publisherCARoots'),
    countersignRoots: decodeBase64Array(trustWire.countersignRoots, 'trust.countersignRoots'),
    logPublicKey: {
      name: logKey.name,
      key: decodeBase64(logKey.key, 'trust.logPublicKey.key'),
    } satisfies LogPublicKey,
  };
  return {
    gate: root.gate as DeploymentGateConfig,
    resolveEndpoint: root.resolveEndpoint as string,
    feedUrl: root.feedUrl as string,
    servingOrigin: root.servingOrigin as string,
    trust,
  };
}

/** The absolute-or-root path `federated.json` is fetched from, under the app base. */
function configUrl(base?: string): string {
  const resolved = base ?? (import.meta.env.BASE_URL || '/');
  return `${resolved.replace(/\/+$/, '')}/${FEDERATED_CONFIG_PATH}`;
}

/**
 * Load the deployment's federated config (see the module doc). Resolves `null` when
 * no config is served (or it is unreachable) — federation stays inert — and throws
 * {@link FederatedConfigError} when a config **is** served but is malformed.
 */
export async function loadFederatedConfig(
  deps: LoadFederatedConfigDeps = {},
): Promise<FederatedRegistryConfig | null> {
  const doFetch = (deps.fetch ?? globalThis.fetch).bind(globalThis);
  const url = configUrl(deps.base);

  let response: Response;
  try {
    response = await doFetch(url, { credentials: 'same-origin' });
  } catch {
    // Unreachable (offline / CORS / the showcase serves none): inert, not an error.
    return null;
  }
  // Absent or any non-success transport status → inert (today's behavior).
  if (!response.ok) return null;

  let wire: unknown;
  try {
    wire = await response.json();
  } catch {
    throw new FederatedConfigError(`${url} was served but did not contain valid JSON`);
  }

  // A served-but-malformed config fails loud (decode: base64/shape; validate: URLs/trust).
  const config = decodeFederatedConfig(wire);
  validateFederatedRegistryConfig(config);
  return config;
}
