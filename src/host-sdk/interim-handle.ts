/**
 * The **interim** host `HostSDK` handle (docs/SPEC.md §6, §3, §2, FR-9 — Phase A).
 *
 * SPEC §6 makes the dashboard the *reference implementation* of the
 * `@gridmason/sdk` host interface: the enforcing handle that runs the
 * remote-identity check and `min(user, widget-capability)` intersection as
 * reference code. That enforcing handle is a **Phase B** deliverable (D-E4,
 * FR-9/FR-14) — it needs the API-side instance-token mint and the SW transport
 * that do not exist yet. This module is the **Phase-A stand-in** that lets the
 * static boot mount widgets with a real handle in the meantime.
 *
 * It is **fixture/no-op-backed** and performs **no real capability enforcement
 * and no server-minted instance token** (SPEC §3 "the enforcing rail is Phase
 * B; here per-instance identity is distinct but not yet API-enforced"): every
 * handle delegates to the SDK's own dev implementations —
 * {@link createNoopSDK} (empty typed defaults) or, when the mount has host data
 * to read, {@link createFixtureSDK} (author-supplied records, capabilities
 * granted so a read is never denied in Phase A). What it *does* provide is the
 * one contract Phase A must exercise:
 *
 * - **The reference `HostSDK` shape.** The value this factory returns *is* a
 *   {@link HostSDK}, so a context-consumer widget (record-summary, #6) reaches
 *   its record **through** `sdk.records.read` rather than around the handle.
 *   Phase B swaps the backing for the enforcing implementation **without any
 *   widget-ABI change** — the widget still reads the same `HostSDK`.
 * - **Distinct per-instance identity.** Each mount is minted a distinct,
 *   unguessable {@link mintInstanceId | instance id} held inside the handle
 *   (`sdk.identity.instanceId`), so two mounts of the same widget on one page
 *   carry distinct identities. In Phase A this identity is *distinct but not yet
 *   API-enforced* — the unforgeable server-verified token is D-E4.
 *
 * The per-mount wiring (mint one handle per mounted widget, keep it stable
 * across re-renders, release it on unmount) lives in {@link InterimHandleRegistry}
 * (`./registry`); the demo host data a record-scoped page reads lives in
 * `./host-data`.
 */

import { createNoopSDK } from '@gridmason/sdk/noop';
import { createFixtureSDK, type FixtureFile } from '@gridmason/sdk/fixture';
import type { HostSDK, WidgetId } from '@gridmason/sdk';
import type { Capability, PageContext } from '@gridmason/sdk';

/**
 * The host-supplied data backing one mount's handle in Phase A: the fixture
 * records/responses the handle serves and the capabilities it grants so those
 * reads are not denied. Assembled from the page context by `./host-data`; absent
 * when the mount has nothing to read (a no-context page), in which case the
 * handle is no-op-backed.
 */
export interface HostData {
  /** Fixture records/responses this handle serves through `records`/`net`. */
  readonly fixtures: FixtureFile;
  /**
   * Capabilities granted to this mount. Phase A grants exactly what the page's
   * data needs so a read is never denied — there is **no** `min(user, widget)`
   * intersection yet (that is the Phase-B enforcing handle, D-E4). The fixture
   * backing still runs its own capability check, so these must cover the reads.
   */
  readonly capabilities: readonly Capability[];
}

/** Everything the factory needs to mint one mount's interim handle. */
export interface InterimMountInput {
  /**
   * The mount's stable key within its page — the layout grid-item id (`i`), also
   * the widget's `instance-id` ABI attribute. Distinct from the minted
   * {@link HostSDK.identity | identity.instanceId}: this keys the mount so a
   * re-render reuses the same handle; the identity is the unguessable per-mount
   * token held inside the handle.
   */
  readonly mountKey: string;
  /** The `(source, tag)` identity of the widget mounted here (the layout item's `widgetID`). */
  readonly widgetId: WidgetId;
  /** The page context value exposed as `sdk.context`; omit for a page with no context. */
  readonly context?: PageContext;
  /** The host data backing this mount's reads; omit for a no-op (empty-default) handle. */
  readonly hostData?: HostData;
}

/** Monotonic suffix so two mints in the same millisecond still read distinctly in a log. */
let mintCounter = 0;

/**
 * Mint an unguessable per-mount instance id (SPEC §3 "the shell mints an
 * unforgeable per-instance token"). Phase A mints it **client-side** — it makes
 * each handle's identity distinct and non-sequential, but it is not yet the
 * server-verified token the API maps to `(instanceId, widgetId, capabilities)`;
 * that binding is D-E4. Uses `crypto.randomUUID` where available, falling back
 * to `getRandomValues`/`Math.random` so the factory works under Node test runs
 * and older embeds alike.
 */
export function mintInstanceId(): string {
  const seq = (mintCounter = (mintCounter + 1) & 0xffff).toString(16).padStart(4, '0');
  const g: typeof globalThis & { crypto?: Crypto } = globalThis;
  if (typeof g.crypto?.randomUUID === 'function') {
    return `inst-${g.crypto.randomUUID()}-${seq}`;
  }
  if (typeof g.crypto?.getRandomValues === 'function') {
    const bytes = g.crypto.getRandomValues(new Uint8Array(16));
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return `inst-${hex}-${seq}`;
  }
  return `inst-${Math.random().toString(16).slice(2).padEnd(16, '0')}-${seq}`;
}

/**
 * Create one mount's interim {@link HostSDK} handle (docs/SPEC.md §6, Phase A).
 *
 * Fixture-backed when the mount carries {@link InterimMountInput.hostData} (so a
 * context consumer reads real records through `sdk.records.read`), no-op-backed
 * otherwise (empty typed defaults). Either way the returned value is a full
 * `HostSDK` carrying a freshly {@link mintInstanceId | minted} distinct identity
 * — **not** an enforcing host: it binds no server-verified token and applies no
 * `min(user, widget)` intersection (SPEC §3, both Phase B / D-E4). The backing is
 * an implementation detail Phase B replaces without touching the widget ABI.
 */
export function createInterimHandle(input: InterimMountInput): HostSDK {
  const instanceId = mintInstanceId();
  const context = input.context;
  if (input.hostData !== undefined) {
    return createFixtureSDK(input.hostData.fixtures, {
      instanceId,
      widgetId: input.widgetId,
      capabilities: input.hostData.capabilities,
      ...(context !== undefined ? { context } : {}),
      label: 'gridmason-dashboard-interim-sdk',
    });
  }
  return createNoopSDK({
    instanceId,
    widgetId: input.widgetId,
    ...(context !== undefined ? { context } : {}),
    label: 'gridmason-dashboard-interim-sdk',
  });
}
