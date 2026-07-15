/**
 * The mount-path adapter for the revocation **kill** hook (docs/SPEC.md §2, FR-12;
 * #17 `../boot/revocation-gate`). `applyRevocation` already keeps a killed remote
 * out of the import map at boot, so a killed remote never *newly* mounts; this
 * closes the complementary case — an instance that was **already running** when a
 * later feed marks its artifact `killed` (or fails its whole registry closed) must
 * be **force-unmounted** (registry SPEC §6: `killed` unmounts a live instance,
 * `revoked` only blocks new loads).
 *
 * This pure function maps the canvas's mounted federated instances onto
 * {@link resolveKills} and returns the **instance ids** the mount path must unmount.
 * It is the narrow, testable seam between the DOM-side `CanvasHost` (which knows the
 * mounted instances and owns the unmount) and the revocation gate (which owns the
 * kill decision) — no DOM, no I/O.
 */
import type { WidgetID } from '@gridmason/protocol';
import { resolveKills, type MountedRemote } from './revocation-gate';
import type { RegistryRevocationVerdict } from './revocation-feed';

/** One mounted instance the mount path offers for a kill decision: its grid-item id + identity. */
export interface MountedFederatedInstance {
  /** The grid-item instance id (`i`) the canvas would unmount. */
  readonly instanceId: string;
  /** The placed instance's source-qualified identity (`source` = registry id, plus `tag`). */
  readonly widgetID: WidgetID;
}

/**
 * The subset of `mounted` instance ids that must be force-unmounted under the
 * current revocation `verdicts`. Only instances whose `source` names a **governed**
 * registry (one that has a verdict) are candidates — a local, sideloaded, or
 * other-registry instance is never touched. `versions` supplies each verified tag's
 * exact version so an exact `tag@version` kill matches; a registry that failed
 * closed and a bare-tag kill are version-independent, so a live instance whose
 * version is unknown (e.g. it was verified in an earlier boot generation) is still
 * unmounted in those cases.
 */
export function federatedKilledInstanceIds(
  mounted: readonly MountedFederatedInstance[],
  verdicts: ReadonlyMap<string, RegistryRevocationVerdict>,
  versions: ReadonlyMap<string, string>,
): readonly string[] {
  const governed = mounted.filter((instance) => verdicts.has(instance.widgetID.source));
  if (governed.length === 0) return [];

  const remotes: MountedRemote[] = governed.map((instance) => ({
    registryId: instance.widgetID.source,
    tag: instance.widgetID.tag,
    version: versions.get(instance.widgetID.tag) ?? '',
  }));

  // resolveKills filters `remotes` by reference, so a returned entry identifies its
  // governed instance by position.
  const killed = new Set(resolveKills(remotes, verdicts));
  return governed.filter((_, i) => killed.has(remotes[i]!)).map((instance) => instance.instanceId);
}
