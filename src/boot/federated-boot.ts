/**
 * The **federated boot orchestrator** (docs/SPEC.md §2; FR-10) — composes #15's
 * three boot units and #16's verification into the single call the provider runs to
 * produce the deployment's verified federated remotes:
 *
 * ```
 * buildGateSnapshot   (../boot/gate-snapshot)        which remotes are enabled
 *   → resolveGateSnapshot (../boot/resolution-client)   POST /v1/resolve → fragment
 *   → assembleFederatedImportMap (../boot/import-map-assembly)  absolute-URL map + bundles
 *   → verifyAssembledModules (../boot/release-verification)     verify each release
 *   → federatedRemote (../boot/federated-remote)               verified → mountable remote
 * ```
 *
 * The result is everything the render path and the D-E4 Service Worker need:
 * - `remotes` — the **verified** modules as mountable {@link LocalRemote}s (a
 *   refused module produces none, so it can never mount: fail closed, SPEC §2).
 * - `imports` / `scopes` — the declarative native-ESM import map, **filtered to the
 *   verified modules**. Carried as data for the SW-controlled boot to inject once it
 *   controls the page (SPEC §2: "the import map is assembled only after the Service
 *   Worker controls the page" — that injection is FR-11/#19); the entry itself loads
 *   by absolute URL through the remote's `load` thunk, so #16's mount path does not
 *   depend on the map being injected.
 * - `urlHashes` — the merged `url → content-hash` enforcement table across every
 *   verified release, keyed by exact URL. **This is the release-doc data plumbed to
 *   the verification layer** the D-E4 SW enforces per fetch (#19).
 * - `refused` / `excluded` — modules refused by verification, and modules the
 *   registry could not resolve, for the SPEC §6/§8 refusal / fallback cards.
 *
 * **Single-registry.** A gate snapshot targets one registry (registry SPEC §9), so
 * this resolves and assembles one fragment. Multi-registry deployments run one boot
 * per registry and merge; the assembly step already supports the merge.
 *
 * Pure and DOM-free (all I/O is injected): importing it evaluates no widget code.
 */
import type { ExcludedModule } from '@gridmason/protocol';
import type { MultihashString } from '@gridmason/protocol/verify';
import { buildGateSnapshot } from './gate-snapshot';
import { resolveGateSnapshot } from './resolution-client';
import { assembleFederatedImportMap } from './import-map-assembly';
import {
  verifyAssembledModules,
  type RefusedModule,
  type VerifyDeps,
} from './release-verification';
import { federatedRemote, type FederatedRemoteDeps } from './federated-remote';
import {
  validateFederatedRegistryConfig,
  type FederatedRegistryConfig,
} from './federated-config';
import type { LocalRemote } from './import-map';

/**
 * The outcome of a federated boot: the verified mountable remotes, the verified-only
 * declarative import map (`imports` + `scopes`) and its `url → hash` enforcement
 * table, and the refused / excluded modules for their cards.
 */
export interface FederatedBootResult {
  /** The verified federated remotes, as import-map entries to merge with the local map. */
  readonly remotes: readonly LocalRemote[];
  /** Bare specifier → absolute entry URL, **verified modules only** (for the #19 injected map). */
  readonly imports: Readonly<Record<string, string>>;
  /** Import-map `scopes`, keyed by absolute entry URL, **verified modules only** (shared-dep skews). */
  readonly scopes: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Every verified release's servable URL → content hash, merged — the D-E4 SW's enforcement table. */
  readonly urlHashes: ReadonlyMap<string, MultihashString>;
  /** Modules refused by verification (for refusal cards); never in {@link imports} or {@link remotes}. */
  readonly refused: readonly RefusedModule[];
  /** Modules the registry could not resolve (for fallback cards); reasons carried from the fragment. */
  readonly excluded: readonly ExcludedModule[];
  /** Verified tag → display name, for the render path's boundary descriptor. */
  readonly names: ReadonlyMap<string, string>;
}

/** Injectable collaborators for {@link bootFederated} — defaulted for production, overridden in tests. */
export interface FederatedBootDeps extends VerifyDeps, FederatedRemoteDeps {
  /** `fetch` used for the resolution call. Defaults to the global. */
  readonly fetchImpl?: typeof fetch;
  /** Abort signal, so a slow boot can be cancelled on teardown. */
  readonly signal?: AbortSignal;
}

/** A fresh empty result — a deployment with nothing federated enabled (own Maps, never shared). */
function emptyResult(): FederatedBootResult {
  return {
    remotes: [],
    imports: {},
    scopes: {},
    urlHashes: new Map(),
    refused: [],
    excluded: [],
    names: new Map(),
  };
}

/**
 * Run the federated boot for one registry config. Validates the config, builds and
 * resolves the gate snapshot, assembles the absolute-URL import map, verifies every
 * resolved release, and returns the verified remotes + plumbed enforcement data.
 *
 * A gate with **no enabled modules** short-circuits before any network call (nothing
 * to resolve). A resolve that returns only excluded modules yields empty `remotes`
 * with the `excluded` list carried through. Verification failures never throw here —
 * they land in `refused`, and the corresponding remote/import is simply absent (fail
 * closed). A *resolution* failure (transport / non-2xx / malformed) does throw
 * (`ResolutionError`); the provider fails the whole federated set closed on it.
 */
export async function bootFederated(
  config: FederatedRegistryConfig,
  deps: FederatedBootDeps = {},
): Promise<FederatedBootResult> {
  validateFederatedRegistryConfig(config);

  const snapshot = buildGateSnapshot(config.gate);
  if (snapshot.modules.length === 0) {
    // Nothing enabled — no resolve, no verify. The gate is the kill switch (SPEC §2).
    return emptyResult();
  }

  const fragment = await resolveGateSnapshot(snapshot, {
    endpoint: config.resolveEndpoint,
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
  });

  const assembled = assembleFederatedImportMap({ imports: {} }, [
    { fragment, servingOrigin: config.servingOrigin },
  ]);

  const { verified, refused } = await verifyAssembledModules(assembled.modules, config.trust, {
    ...(deps.verify !== undefined ? { verify: deps.verify } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });

  // Fail closed: only verified specifiers/entry-URLs may appear in the injectable
  // map. A refused module's import + scope are dropped so the eventual `<script
  // type="importmap">` (#19) can never map a bare specifier to unverified code.
  const verifiedSpecifiers = new Set(verified.map((v) => v.module.specifier));
  const verifiedUrls = new Set(verified.map((v) => v.module.url));

  const imports: Record<string, string> = {};
  for (const [specifier, url] of Object.entries(assembled.imports)) {
    if (verifiedSpecifiers.has(specifier)) imports[specifier] = url;
  }
  const scopes: Record<string, Readonly<Record<string, string>>> = {};
  for (const [entryUrl, mapping] of Object.entries(assembled.scopes)) {
    if (verifiedUrls.has(entryUrl)) scopes[entryUrl] = mapping;
  }

  // Merge every verified release's url→hash table into the one enforcement map the
  // D-E4 SW consults. URLs are hash-addressed (`/v1/artifacts/:hash`), so the same
  // URL never carries two different hashes across releases.
  const urlHashes = new Map<string, MultihashString>();
  for (const { urlHashes: table } of verified) {
    for (const [url, hash] of table) urlHashes.set(url, hash);
  }

  const remotes = verified.map((v) =>
    federatedRemote(v, {
      ...(deps.importModule !== undefined ? { importModule: deps.importModule } : {}),
    }),
  );
  const names = new Map(verified.map((v) => [v.module.tag, v.module.tag]));

  return { remotes, imports, scopes, urlHashes, refused, excluded: assembled.excluded, names };
}
