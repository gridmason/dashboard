/**
 * Boot step 4 — **release verification** on the lazy verified-mount path
 * (docs/SPEC.md §2, §5; FR-10). The step #15 deliberately left unwired:
 *
 * ```
 * gate snapshot (../boot/gate-snapshot)
 *   → registry resolution API (../boot/resolution-client)
 *   → import map assembled (../boot/import-map-assembly)
 *   → release verification (this module)   ← verify each resolved module before it can mount
 *   → lazy verified import() (../boot/federated-remote, ../boot/federated-boot)
 * ```
 *
 * Every {@link AssembledModule} carries the {@link SignatureBundle}
 * (`{ release, envelope, logEntry }`) the registry resolved for it — **identical in
 * shape to the serving surface's `GET /v1/releases/:hash` body** (registry
 * docs/serving.md), so a host verifies a fragment entry with **no second fetch**.
 * This module hands that bundle, plus the operator's out-of-band trust material
 * (../boot/federated-config), to `@gridmason/protocol`'s `verifyRelease` — the pure,
 * isomorphic verify core (publisher signature + registry countersignature +
 * content-hash-of-release + transparency-log inclusion + trust-root pinning). It
 * interprets none of the crypto: `verifyRelease` is the security core (held at 100%
 * coverage in `@gridmason/protocol`), and this is its call site.
 *
 * **Fail closed (SPEC §2, §7).** A module whose release does not verify is
 * **refused**: it is dropped from the verified set with a stable, non-leaky
 * {@link VerifyReleaseReason}, so it never becomes a mountable remote and its code
 * is never imported. Only a {@link VerifiedModule} — carrying the `url → hash`
 * enforcement table `verifyRelease` returns — flows on to the lazy import path. That
 * table is what the D-E4 Service Worker (#19) enforces per fetch by exact URL +
 * content hash; here it is *produced and plumbed*, not yet enforced per byte.
 *
 * **Verify is injected.** `verifyRelease` is taken as a dependency (defaulting to
 * the real one) so this module's *partitioning and plumbing* is unit-tested without
 * standing up a full signed release + trust chain — the crypto itself is proven in
 * `@gridmason/protocol`. Pure and DOM-free: importing it evaluates no widget code.
 */
import {
  verifyRelease as defaultVerifyRelease,
  type MultihashString,
  type VerifyReleaseReason,
} from '@gridmason/protocol/verify';
import type { AssembledModule } from './import-map-assembly';
import type { FederatedTrustConfig } from './federated-config';

/**
 * A resolved module whose release **verified**: the module (with its absolute,
 * hash-pinned entry URL) plus the `url → content-hash` enforcement table
 * `verifyRelease` returned — every servable URL of the release mapped to the hash
 * the D-E4 Service Worker will enforce per fetch (#19).
 */
export interface VerifiedModule {
  /** The assembled module, verified — safe to turn into a mountable remote. */
  readonly module: AssembledModule;
  /** Every servable URL of this release mapped to its verified content hash (the SW's table). */
  readonly urlHashes: ReadonlyMap<string, MultihashString>;
}

/**
 * A resolved module whose release **did not verify**: the module and the single
 * stable, non-leaky {@link VerifyReleaseReason} it refused with. Carried (not
 * silently dropped) so the host can render the SPEC §6/§8 refusal card — but the
 * module never enters the import map and its code is never imported (fail closed).
 */
export interface RefusedModule {
  /** The assembled module that failed verification. */
  readonly module: AssembledModule;
  /** Why it refused — a fixed, input-free reason (SPEC §7 no-tag-echo). */
  readonly reason: VerifyReleaseReason;
}

/** The verify verdict for one module: either {@link VerifiedModule} or {@link RefusedModule}. */
export type ModuleVerdict =
  | ({ readonly ok: true } & VerifiedModule)
  | ({ readonly ok: false } & RefusedModule);

/** The partition of a resolved set into the modules that may mount and those refused. */
export interface VerifyPartition {
  /** Modules whose release verified — the only ones that become mountable remotes. */
  readonly verified: readonly VerifiedModule[];
  /** Modules refused by verification — for refusal cards, never for the import map. */
  readonly refused: readonly RefusedModule[];
}

/** Injectable collaborators for the verify plumbing — defaulted for production, overridden in tests. */
export interface VerifyDeps {
  /**
   * The verify core. Defaults to `@gridmason/protocol`'s `verifyRelease`; injected
   * so the partitioning logic is tested without a full signed release + trust chain
   * (the crypto is proven in the protocol package, not re-tested here).
   */
  readonly verify?: typeof defaultVerifyRelease;
  /** Caller-supplied clock (epoch ms) for the release's validity-window checks. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Verify one resolved module's release against the operator's trust material.
 * Composes the module's carried {@link SignatureBundle} (release + envelope +
 * logEntry) with the out-of-band `trust` (pins, roots, log key) and `now`, and runs
 * `verifyRelease`. Returns a verified verdict (with the enforcement table) or a
 * refused verdict (with the stable reason). Never throws — `verifyRelease` maps
 * every failure to a reason rather than throwing (SPEC §5).
 */
export async function verifyResolvedModule(
  module: AssembledModule,
  trust: FederatedTrustConfig,
  deps: VerifyDeps = {},
): Promise<ModuleVerdict> {
  const verify = deps.verify ?? defaultVerifyRelease;
  const now = deps.now?.() ?? Date.now();
  const { release, envelope, logEntry } = module.bundle;

  const result = await verify({
    release,
    envelope,
    logEntry,
    trustRoot: trust.trustRoot,
    pins: trust.pins,
    publisherCARoots: trust.publisherCARoots,
    countersignRoots: trust.countersignRoots,
    logPublicKey: trust.logPublicKey,
    now,
  });

  if (result.ok) {
    return { ok: true, module, urlHashes: result.urlHashes };
  }
  return { ok: false, module, reason: result.reason };
}

/**
 * Verify a whole assembled set, partitioning it into {@link VerifyPartition.verified}
 * and {@link VerifyPartition.refused}. Modules are verified concurrently (each is an
 * independent pure computation); order within each bucket follows the input. The
 * caller turns only the verified bucket into mountable remotes (fail closed).
 */
export async function verifyAssembledModules(
  modules: readonly AssembledModule[],
  trust: FederatedTrustConfig,
  deps: VerifyDeps = {},
): Promise<VerifyPartition> {
  const verdicts = await Promise.all(
    modules.map((module) => verifyResolvedModule(module, trust, deps)),
  );

  const verified: VerifiedModule[] = [];
  const refused: RefusedModule[] = [];
  for (const verdict of verdicts) {
    if (verdict.ok) {
      verified.push({ module: verdict.module, urlHashes: verdict.urlHashes });
    } else {
      refused.push({ module: verdict.module, reason: verdict.reason });
    }
  }
  return { verified, refused };
}
