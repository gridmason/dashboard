/**
 * Boot step 1 — the **gate snapshot** (docs/SPEC.md §2, FR-10; GW-D21).
 *
 * ```
 * boot → gate snapshot (which widgets/plugins enabled for this deployment)  ← this module
 *   → registry resolution API (../boot/resolution-client)
 *   → import map assembled (../boot/import-map-assembly)
 *   → lazy verified import()  (#16)
 * ```
 *
 * A gate snapshot is the *host's* enablement state: the exact, source-qualified
 * `(publisher, tag, version)` remotes this deployment has turned on, plus the
 * shared-dependency majors the shell offers so resolution can scope skews. This
 * module turns the deployment's **config-file** enablement into the protocol
 * {@link GateSnapshot} wire shape the resolution client sends — it decides
 * *enablement*, the registry only qualifies it with verifiable URLs (it is never a
 * control plane the deployment must phone; registry SPEC §1, §8).
 *
 * **Single-tenant, config-file driven (GW-D21).** Pre-1.0 there is one tenant and
 * one config file; a module's `enabled` flag is the gate. A disabled module is
 * dropped from the snapshot, so its remote never reaches the resolver and never
 * enters the import map — the **gate is the kill switch** (SPEC §2). This mirrors
 * the server's config-file gate flags (`server/config`), on the browser side.
 *
 * **Fails loud.** A structurally invalid gate config throws {@link GateConfigError}
 * rather than silently resolving a half-configured deployment — the same posture
 * as the server config loader. Enablement is decided here; verification of what the
 * registry returns is a later step (#16) and no concern of this module.
 */
import type { GateModule, GateSnapshot, SharedOffer } from '@gridmason/protocol';

/**
 * One remote in the deployment's gate config: an exact, source-qualified
 * `(publisher, tag, version)` plus its gate. `enabled` defaults to `true` when
 * omitted; `enabled: false` is the kill switch — the module is dropped from the
 * snapshot and never resolved (SPEC §2). Versions are **exact** — the gate service
 * already chose one; resolution never sees a range (GW-D19).
 */
export interface GateModuleConfig {
  /** Publisher namespace prefix (unique within the target registry). */
  readonly publisher: string;
  /** The widget custom-element tag (publisher-prefixed). */
  readonly tag: string;
  /** The exact SemVer of the enabled artifact. */
  readonly version: string;
  /** Whether this remote is enabled for the deployment. Omitted = enabled. */
  readonly enabled?: boolean;
}

/**
 * The deployment's federated-boot config (config-file driven, GW-D21): which
 * registry to resolve against, the gated modules, and the shared-dependency majors
 * the shell offers per bare specifier. `shared` is optional — a deployment of fully
 * self-contained remotes offers none.
 */
export interface DeploymentGateConfig {
  /**
   * The single registry this deployment resolves against — its id, which the
   * resolver requires the snapshot to name (registry SPEC §9: a host pins each
   * prefix to one registry, so a snapshot is single-registry).
   */
  readonly registry: string;
  /** The gated remotes. May be empty (nothing enabled ⇒ an empty snapshot). */
  readonly modules: readonly GateModuleConfig[];
  /** Shared-dependency majors the shell offers, keyed by bare specifier. */
  readonly shared?: Readonly<Record<string, readonly SharedOffer[]>>;
}

/**
 * Thrown when a deployment gate config is structurally invalid. Fails the boot
 * loudly rather than sending a malformed snapshot the resolver would refuse.
 */
export class GateConfigError extends Error {
  override readonly name = 'GateConfigError';
  constructor(detail: string) {
    super(`Invalid deployment gate config: ${detail}`);
  }
}

/**
 * Build the protocol {@link GateSnapshot} for a deployment: validate the config,
 * then include only the **enabled** modules (the gate is the kill switch). An empty
 * enabled set is valid and yields an empty snapshot — a deployment with nothing
 * federated enabled resolves to an empty fragment. `shared` is carried through
 * verbatim so resolution can scope shared-dep majors against what the shell offers.
 */
export function buildGateSnapshot(config: DeploymentGateConfig): GateSnapshot {
  validateConfig(config);

  const modules: GateModule[] = config.modules
    .filter((module) => module.enabled !== false)
    .map(({ publisher, tag, version }) => ({ publisher, tag, version }));

  return {
    registry: config.registry,
    modules,
    ...(config.shared !== undefined ? { shared: config.shared } : {}),
  };
}

function validateConfig(config: DeploymentGateConfig): void {
  if (typeof config.registry !== 'string' || config.registry === '') {
    throw new GateConfigError('`registry` must be a non-empty string');
  }
  if (!Array.isArray(config.modules)) {
    throw new GateConfigError('`modules` must be an array');
  }
  config.modules.forEach((module, i) => validateModule(module, i));
  if (config.shared !== undefined) {
    validateShared(config.shared);
  }
}

function validateModule(module: GateModuleConfig, index: number): void {
  const at = `modules[${index}]`;
  for (const field of ['publisher', 'tag', 'version'] as const) {
    if (typeof module[field] !== 'string' || module[field] === '') {
      throw new GateConfigError(`${at}.${field} must be a non-empty string`);
    }
  }
  if (module.enabled !== undefined && typeof module.enabled !== 'boolean') {
    throw new GateConfigError(`${at}.enabled must be a boolean`);
  }
}

function validateShared(shared: Readonly<Record<string, readonly SharedOffer[]>>): void {
  for (const [specifier, offers] of Object.entries(shared)) {
    if (!Array.isArray(offers)) {
      throw new GateConfigError(`\`shared["${specifier}"]\` must be an array of offers`);
    }
    offers.forEach((offer, i) => {
      const at = `shared["${specifier}"][${i}]`;
      if (!Number.isInteger(offer.major)) {
        throw new GateConfigError(`${at}.major must be an integer`);
      }
      if (typeof offer.url !== 'string' || offer.url === '') {
        throw new GateConfigError(`${at}.url must be a non-empty string`);
      }
    });
  }
}
