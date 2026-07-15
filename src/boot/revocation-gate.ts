/**
 * Boot step 3.5 (apply) — **apply revocation verdicts to the resolved remotes**
 * (docs/SPEC.md §2, FR-12; registry SPEC §6).
 *
 * {@link ../boot/revocation-feed} produces one {@link RegistryRevocationVerdict}
 * per trusted registry; this pure module *applies* those verdicts so the gate acts
 * as the kill switch (SPEC §2). Two operations, no I/O:
 *
 * 1. **{@link applyRevocation}** — before {@link ../boot/import-map-assembly}
 *    assembles the map, filter each resolved registry's fragment: a **fail-closed**
 *    registry drops out entirely (all its remotes refused, scoped to it), and a
 *    fresh registry's individually **revoked/killed** artifacts are removed. The
 *    surviving fragments assemble into a map that, by construction, contains no
 *    revoked/killed/refused remote — so a killed remote **drops from the import map
 *    without a redeploy** the moment the feed lists it (SPEC §2). The refused
 *    remotes are returned separately for the SPEC §6/§8 fallback cards.
 *
 * 2. **{@link resolveKills}** — for remotes *already mounted*, decide which must be
 *    force-unmounted now. Per registry SPEC §6 the two states differ: `revoked`
 *    blocks **new** loads but leaves a running instance alone, while `killed` (and
 *    any whole-registry fail-close) additionally **unmounts** the running instance.
 *    This returns the unmount set only — wiring it to the actual unmount is the
 *    lazy-mount path's job (#16, out of scope here); this is the narrow hook that
 *    path consumes.
 *
 * **Artifact matching (registry SPEC §6, exact-string).** A feed entry's `artifact`
 * is a publisher-prefixed tag, optionally version-qualified. A resolved module
 * `(tag, version)` is blocked when a blocked entry's `artifact` equals either the
 * module's `tag` (blocks every version of that tag) or `` `${tag}@${version}` ``
 * (blocks that exact version). Matching is verbatim; no range interpretation.
 *
 * **A missing verdict fails closed.** Every conforming gate MUST consume the feed
 * (registry SPEC §6), so a resolved registry with no verdict in the map is treated
 * as fail-closed rather than silently admitted — the safe default for a kill switch.
 */
import type { BlockedArtifact } from '@gridmason/protocol';
import type { ResolvedRegistry } from './import-map-assembly';
import type { RegistryRevocationVerdict } from './revocation-feed';

/**
 * A remote refused by revocation, for the SPEC §6/§8 fallback card + telemetry. It
 * never enters the assembled import map; `reason` distinguishes a per-artifact
 * revoke/kill from a whole-registry fail-close.
 */
export interface RefusedRemote {
  /** The source registry id the remote was resolved from. */
  readonly registryId: string;
  /** Publisher prefix that owns the tag on this registry. */
  readonly publisher: string;
  /** The widget custom-element tag. */
  readonly tag: string;
  /** The exact resolved version. */
  readonly version: string;
  /**
   * Why it was refused: `revoked`/`killed` from a per-artifact feed entry, or
   * `registry-fail-closed` because its whole registry failed closed (stale,
   * unreachable, unverified, rolled back, or missing a verdict).
   */
  readonly reason: 'revoked' | 'killed' | 'registry-fail-closed';
}

/** The result of {@link applyRevocation}: the safe-to-assemble registries + the refused remotes. */
export interface RevocationApplication {
  /**
   * The resolved registries filtered so no revoked/killed remote and no
   * fail-closed registry remains — pass straight to `assembleFederatedImportMap`.
   */
  readonly registries: readonly ResolvedRegistry[];
  /** The remotes revocation refused, for fallback cards (never in the import map). */
  readonly refused: readonly RefusedRemote[];
}

/**
 * Filter the resolved registries by their revocation verdicts. A fail-closed (or
 * verdict-less) registry is dropped whole; a fresh registry keeps only its
 * un-blocked modules, with each fragment rebuilt so its `imports`, `modules`, and
 * `scopes` reference exactly the surviving modules. Refused remotes are collected
 * separately. Purely functional — inputs are not mutated.
 */
export function applyRevocation(
  registries: readonly ResolvedRegistry[],
  verdicts: ReadonlyMap<string, RegistryRevocationVerdict>,
): RevocationApplication {
  const kept: ResolvedRegistry[] = [];
  const refused: RefusedRemote[] = [];

  for (const resolved of registries) {
    const registryId = resolved.fragment.registry;
    const verdict = verdicts.get(registryId);

    // A fail-closed registry (or one with no verdict — every gate MUST consume the
    // feed) refuses all its remotes, scoped to itself.
    if (verdict === undefined || verdict.failClosed) {
      for (const module of resolved.fragment.modules) {
        refused.push(refusedRemote(module, 'registry-fail-closed'));
      }
      continue;
    }

    kept.push(filterRegistry(resolved, verdict.blocked, refused));
  }

  return { registries: kept, refused };
}

/**
 * A remote that is currently mounted, identified by the registry + `(tag, version)`
 * the kill decision matches against. The lazy-mount path (#16) supplies these from
 * its live instances and force-unmounts whatever {@link resolveKills} returns.
 */
export interface MountedRemote {
  /** The registry the mounted remote was resolved from. */
  readonly registryId: string;
  /** The widget custom-element tag of the mounted remote. */
  readonly tag: string;
  /** The exact version of the mounted remote. */
  readonly version: string;
}

/**
 * Decide which already-mounted remotes must be force-unmounted now. A mounted
 * remote is unmounted when its registry failed closed (or has no verdict), or when
 * it matches a **`killed`** feed entry. A **`revoked`** match is *not* unmounted —
 * revoke blocks new loads but leaves a running instance alone (registry SPEC §6).
 * Returns the subset to unmount, preserving input order; the caller (#16) performs
 * the unmounting.
 */
export function resolveKills(
  mounted: readonly MountedRemote[],
  verdicts: ReadonlyMap<string, RegistryRevocationVerdict>,
): readonly MountedRemote[] {
  return mounted.filter((remote) => {
    const verdict = verdicts.get(remote.registryId);
    if (verdict === undefined || verdict.failClosed) {
      return true;
    }
    const hit = matchBlocked(verdict.blocked, remote.tag, remote.version);
    return hit?.state === 'killed';
  });
}

/** Rebuild one fresh registry's fragment keeping only modules no blocked entry names. */
function filterRegistry(
  resolved: ResolvedRegistry,
  blocked: readonly BlockedArtifact[],
  refused: RefusedRemote[],
): ResolvedRegistry {
  const { fragment } = resolved;
  const survivingSpecifiers = new Set<string>();
  const survivingUrls = new Set<string>();

  const modules = fragment.modules.filter((module) => {
    const hit = matchBlocked(blocked, module.tag, module.version);
    if (hit !== undefined) {
      refused.push(refusedRemote(module, hit.state));
      return false;
    }
    survivingSpecifiers.add(module.specifier);
    survivingUrls.add(module.url);
    return true;
  });

  // Keep only the imports/scopes of surviving modules so a dropped remote leaves no
  // trace in the map the fragment assembles into.
  const imports = filterRecord(fragment.imports, (specifier) =>
    survivingSpecifiers.has(specifier),
  );
  const scopes = filterRecord(fragment.scopes, (entryUrl) => survivingUrls.has(entryUrl));

  return {
    ...resolved,
    fragment: { ...fragment, imports, scopes, modules },
  };
}

/**
 * The blocked entry that names `(tag, version)`, or `undefined`. Matches a feed
 * entry `artifact` equal to the bare `tag` (all versions) or the exact
 * `` `${tag}@${version}` ``.
 */
function matchBlocked(
  blocked: readonly BlockedArtifact[],
  tag: string,
  version: string,
): BlockedArtifact | undefined {
  const qualified = `${tag}@${version}`;
  return blocked.find((entry) => entry.artifact === tag || entry.artifact === qualified);
}

function refusedRemote(
  module: ResolvedRegistry['fragment']['modules'][number],
  reason: RefusedRemote['reason'],
): RefusedRemote {
  return {
    registryId: module.source,
    publisher: module.publisher,
    tag: module.tag,
    version: module.version,
    reason,
  };
}

/** Shallow-copy a record keeping only keys the predicate admits. */
function filterRecord<T>(
  record: Readonly<Record<string, T>>,
  keep: (key: string) => boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (keep(key)) {
      out[key] = value;
    }
  }
  return out;
}
