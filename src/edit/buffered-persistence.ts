/**
 * A **staging** {@link LayoutPersistencePort} for the explicit Save / Discard edit
 * flow (mockup 02-edit-mode.html). Core's edit controller persists through its
 * port on *every* committed edit (each drag, resize, add, remove); the dashboard
 * toolbar instead buffers those commits and only writes to the durable API
 * adapter when the user clicks **Save layout** — so **Discard** can throw the
 * pending edits away without ever having touched the backend.
 *
 * It captures only the latest committed document (the controller always commits
 * the whole working layout, so the last commit supersedes the earlier ones) and
 * reports whether an unsaved edit is pending, which drives the toolbar's
 * dirty/Save-enabled state.
 */
import type { LayoutPage } from '@gridmason/protocol';
import type { LayoutPersistencePort } from '@gridmason/core/canvas';
import { cloneLayout, type ScopeKey } from '@gridmason/core/engine';
import type { LayoutPersistenceAdapter } from '../adapters/persistence';

/** A staged, not-yet-persisted edit: the document and the key it will be written under. */
interface StagedEdit {
  readonly key: ScopeKey;
  readonly doc: LayoutPage;
}

/** Buffers the edit controller's commits until an explicit {@link flush} (Save). */
export class BufferedLayoutPersistence implements LayoutPersistencePort {
  #staged: StagedEdit | undefined;
  readonly #onChange: () => void;

  /** @param onChange Called whenever a commit is staged, so the UI can mark the session dirty. */
  constructor(onChange: () => void = () => {}) {
    this.#onChange = onChange;
  }

  /** Stage the controller's committed working layout (copy-on-write fork). Does not touch the network. */
  put(key: ScopeKey, layout: LayoutPage): void {
    // Detach the doc from the controller's live working copy so a later in-place
    // edit can't mutate what we've staged.
    this.#staged = { key, doc: cloneLayout(layout) };
    this.#onChange();
  }

  /** Whether an unsaved edit is pending (drives the toolbar's Save-enabled state). */
  get dirty(): boolean {
    return this.#staged !== undefined;
  }

  /** Drop any staged edit without persisting it (Discard). */
  clear(): void {
    this.#staged = undefined;
  }

  /**
   * Persist the staged edit through `adapter` under the key it was committed at,
   * then clear the buffer (Save). Resolves `false` if nothing was staged.
   */
  async flush(adapter: LayoutPersistenceAdapter): Promise<boolean> {
    const staged = this.#staged;
    if (staged === undefined) return false;
    await adapter.put(staged.key, staged.doc);
    this.#staged = undefined;
    return true;
  }
}
