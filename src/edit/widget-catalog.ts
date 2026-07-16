/**
 * Pure catalog logic for the Add Widget picker (issue #85) — DOM-free so it is
 * unit-testable under Node; the React picker (`./AddWidgetPicker`) is the thin
 * shell over it.
 *
 * Two catalog sources feed the picker:
 *
 * - **Local widgets** — the shell's first-party import map ({@link localCatalogEntries}).
 *   Always addable in edit mode; inserted as `{ source: 'local', tag }`.
 * - **Registry catalog** — a registry's published widgets (`../catalog/registry-catalog`).
 *   A catalog entry is **addable only if it is gated *and* verified** — i.e. it is
 *   present in the federated boot's **admitted set** ({@link resolveCatalogAddability}).
 *   That set is exactly the remotes the deployment's gate enabled *and* the verify
 *   chain admitted, so gating addability on membership can never bypass the gate or
 *   the verify chain (owner direction on #85). An ungated/unadmitted entry is listed
 *   but not addable — the picker shows it disabled with a "not enabled" note.
 */
import { LOCAL_SOURCE, type WidgetID } from '@gridmason/protocol';
import { assembleImportMap, type LocalRemote } from '../boot/import-map';

/** One addable local (first-party) widget for the picker. */
export interface LocalCatalogEntry {
  /** The widget custom-element tag. */
  readonly tag: string;
  /** Human display name. */
  readonly name: string;
  /** The identity to insert when placed (always `local`-sourced). */
  readonly widgetID: WidgetID;
}

/** The shell's local widgets, as addable picker entries (from the import map). */
export function localCatalogEntries(): readonly LocalCatalogEntry[] {
  return [...assembleImportMap().values()].map((remote) => ({
    tag: remote.tag,
    name: remote.name,
    widgetID: { source: LOCAL_SOURCE, tag: remote.tag },
  }));
}

/** The just-enough shape of an admitted federated remote used to decide addability. */
export type AdmittedRemote = Pick<LocalRemote, 'source' | 'tag'>;

/** Whether a registry catalog entry can be placed, and — if so — the identity to insert. */
export interface CatalogAddability {
  /** `true` iff the entry is gated + verified (in the admitted set). */
  readonly addable: boolean;
  /**
   * The identity to insert, present iff {@link addable}. It is the **admitted
   * remote's** own `(source, tag)` — the same identity the canvas merged into its
   * import map — so a placed widget resolves to the verified module, never a
   * caller-reconstructed one.
   */
  readonly widgetID?: WidgetID;
}

/**
 * Decide whether a registry catalog `entry` is addable: addable **iff** the boot
 * admitted a remote with the same `tag` (the admitted set is the gated + verified
 * remotes). Matching by tag mirrors how the canvas merges federated remotes into
 * its import map (by tag); the inserted identity is the admitted remote's own, so
 * the place path stays on the verified module.
 */
export function resolveCatalogAddability(
  entry: { readonly tag: string },
  admitted: readonly AdmittedRemote[],
): CatalogAddability {
  const match = admitted.find((remote) => remote.tag === entry.tag);
  return match !== undefined
    ? { addable: true, widgetID: { source: match.source, tag: match.tag } }
    : { addable: false };
}
