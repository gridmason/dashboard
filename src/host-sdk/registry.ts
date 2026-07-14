/**
 * The per-mount interim-handle factory (docs/SPEC.md §2, §3 — Phase A).
 *
 * SPEC §2 mounts each widget "with context + saved props + **SDK handle**", and
 * SPEC §3 rule 5 requires the handle to be **per-instance**: two mounts of the
 * same widget get distinct handles with distinct identities. This registry is
 * that per-mount factory for Phase A — one instance backs one `PageCanvas` host
 * (`../canvas/CanvasHost`). It owns the map from a mount's stable key (the layout
 * grid-item id) to its minted {@link HostSDK} handle and guarantees:
 *
 * - **Distinct per mount.** {@link handleFor} mints a fresh handle (with a
 *   distinct minted identity) the first time it sees a `mountKey`, so every
 *   placed widget gets its own.
 * - **Stable across re-renders.** A second {@link handleFor} for a live
 *   `mountKey` returns the *same* handle — an in-place context/edit-mode update
 *   (or a relayout that re-runs the mount glue) must not churn a widget's
 *   identity mid-life.
 * - **Released on unmount.** {@link reconcile} drops the handles for mounts no
 *   longer placed — the Phase-A analog of SPEC §3 rule 6's token revocation on
 *   unmount (the enforcing revoke-and-reject is D-E4). {@link reset} clears every
 *   handle when the whole page is torn down / replaced.
 *
 * The registry never touches the DOM: the canvas glue reads the live mount set
 * off `<gm-page-canvas>` and assigns each handle onto the widget element; this
 * only decides *which* handle a mount gets. That keeps the "distinct per mount"
 * rule unit-testable without a browser.
 */

import type { HostSDK } from '@gridmason/sdk';
import { createInterimHandle, type InterimMountInput } from './interim-handle';

/** Mints (via `createInterimHandle`) — injectable so a test can observe minting without a real SDK. */
export type HandleFactory = (input: InterimMountInput) => HostSDK;

/**
 * Per-`PageCanvas` registry of interim SDK handles, keyed by a mount's stable key
 * (the layout grid-item id). See the module doc for the guarantees it upholds.
 */
export class InterimHandleRegistry {
  readonly #handles = new Map<string, HostSDK>();
  readonly #factory: HandleFactory;

  /** @param factory The handle mint; defaults to {@link createInterimHandle}. */
  constructor(factory: HandleFactory = createInterimHandle) {
    this.#factory = factory;
  }

  /**
   * The handle for `input.mountKey`: the existing one if this mount is already
   * live (stable identity across re-renders), otherwise a freshly minted one.
   */
  handleFor(input: InterimMountInput): HostSDK {
    const existing = this.#handles.get(input.mountKey);
    if (existing !== undefined) return existing;
    const handle = this.#factory(input);
    this.#handles.set(input.mountKey, handle);
    return handle;
  }

  /** The current handle for `mountKey`, or `undefined` if none is live. */
  get(mountKey: string): HostSDK | undefined {
    return this.#handles.get(mountKey);
  }

  /** Whether a handle is currently held for `mountKey`. */
  has(mountKey: string): boolean {
    return this.#handles.has(mountKey);
  }

  /**
   * Drop the handles for every mount **not** in `liveKeys` — the mounts the
   * canvas no longer places (unmounted). Returns the keys released. Handles for
   * live mounts are kept (stable identity); a subsequently re-placed key mints a
   * fresh handle, since a re-mount is a new instance.
   */
  reconcile(liveKeys: Iterable<string>): readonly string[] {
    const live = liveKeys instanceof Set ? liveKeys : new Set(liveKeys);
    const released: string[] = [];
    for (const key of this.#handles.keys()) {
      if (!live.has(key)) released.push(key);
    }
    for (const key of released) this.#handles.delete(key);
    return released;
  }

  /** Release the handle for a single `mountKey`. Returns whether one was held. */
  release(mountKey: string): boolean {
    return this.#handles.delete(mountKey);
  }

  /** Drop every handle (page torn down or replaced). */
  reset(): void {
    this.#handles.clear();
  }

  /** How many mounts currently hold a handle. */
  get size(): number {
    return this.#handles.size;
  }
}
