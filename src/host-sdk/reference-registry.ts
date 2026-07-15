/**
 * The per-`PageCanvas` factory of enforcing reference handles (docs/SPEC.md §2,
 * §3 rules 5/6) — the Phase-B replacement for the interim-handle registry. One
 * instance backs one canvas host (`../canvas/CanvasHost`) and owns:
 *
 * - **the host-mediated event bus** shared across this page's mounts (rule 4 —
 *   two co-mounted widgets talk through the host, never a shared global);
 * - **the map from a mount's stable key** (the layout grid-item id) **to its
 *   minted reference handle**, so a handle is distinct per mount (rule 5) and
 *   stable across re-renders (an in-place context/edit update never churns a
 *   widget's identity mid-life);
 * - **unmount revocation** (rule 6): a mount dropped from the placed set is
 *   `unmount()`-ed — its token revoked, its subscriptions released — so a stale
 *   handle's calls reject `InstanceGone` rather than reaching data.
 *
 * The gate each mount enforces is `min(user, widget)`. In the single-tenant demo
 * the acting user is the deployment owner with full access, so `user` defaults to
 * the unscoped grant-all set and the effective gate is the *widget's* declared
 * capabilities — the honest reduction of `min(user, widget)` for a single-user
 * showcase. The asymmetric case (a user narrower than a widget) is exercised
 * against this same enforcing handle by the conformance kit (`conformance.test.ts`)
 * and, end to end over HTTP, by the demo API's own enforcement tests (`server/`).
 */

import type { HostSDK, PageContext, WidgetId } from '@gridmason/sdk';
import type { Capability } from '@gridmason/protocol';
import { CapabilityGate } from './capabilities';
import { HostEventBus } from './event-bus';
import { mintInstanceId, mintInstanceToken } from './mint';
import { createReferenceMount, type ReferenceMount } from './reference-host';
import { LocalDemoTransport, type OutboundTransport } from './transport';
import type { HostInstanceTelemetry } from '../adapters/telemetry';

/**
 * Builds the identity-stamped {@link HostInstanceTelemetry} for one mount (SPEC §3
 * rule 5, FR-15): given the mount's minted `(instanceId, widgetID)`, return the
 * sink its `sdk.telemetry` forwards to. `DashboardTelemetry.hostTelemetryFor` is
 * the reference impl; omitted = no-op telemetry (the interim-handle behavior).
 */
export type MountTelemetryFactory = (identity: {
  readonly instanceId: string;
  readonly widgetID: WidgetId;
}) => HostInstanceTelemetry;

/**
 * The acting user's capabilities in the single-tenant demo: the deployment owner,
 * full access. The `min(user, widget)` gate therefore reduces to the widget's
 * declared set — see the module doc.
 */
const DEMO_USER_CAPABILITIES: readonly Capability[] = [
  { api: 'records.read' },
  { api: 'records.write' },
  { api: 'net' },
  { api: 'events' },
];

/** Everything the factory needs to mint one mount's reference handle. */
export interface ReferenceMountConfig {
  /** The mount's stable key within its page (the layout grid-item id / `instance-id`). */
  readonly mountKey: string;
  /** The `(source, tag)` identity of the widget mounted here. */
  readonly widgetId: WidgetId;
  /** The widget's declared capabilities (its manifest subset) — the `widget` side of `min`. */
  readonly declaredCapabilities: readonly Capability[];
  /** The page context exposed as `sdk.context`; omit for a page with no context. */
  readonly context?: PageContext;
}

/** Options for {@link ReferenceHostRegistry}. */
export interface ReferenceHostRegistryOptions {
  /** The acting user's capabilities; defaults to the demo owner's full access. */
  readonly userCapabilities?: readonly Capability[];
  /** The records/net send seam; defaults to {@link LocalDemoTransport} (the showcase backing). */
  readonly transport?: OutboundTransport;
  /**
   * Builds each mount's identity-stamped telemetry sink (FR-15). Omitted = mounts
   * get the no-op telemetry default, so an existing caller (conformance kit, tests)
   * is unaffected; the canvas wires this to its {@link DashboardTelemetry}.
   */
  readonly telemetryFor?: MountTelemetryFactory;
}

/**
 * Per-canvas registry of enforcing reference handles, keyed by a mount's stable
 * key. See the module doc for the guarantees it upholds.
 */
export class ReferenceHostRegistry {
  readonly #mounts = new Map<string, ReferenceMount>();
  readonly #bus = new HostEventBus();
  readonly #userCapabilities: readonly Capability[];
  readonly #transport: OutboundTransport;
  readonly #telemetryFor: MountTelemetryFactory | undefined;

  constructor(options: ReferenceHostRegistryOptions = {}) {
    this.#userCapabilities = options.userCapabilities ?? DEMO_USER_CAPABILITIES;
    this.#transport = options.transport ?? new LocalDemoTransport();
    this.#telemetryFor = options.telemetryFor;
  }

  /**
   * The handle for `config.mountKey`: the existing one if this mount is already
   * live (stable identity across re-renders), otherwise a freshly minted,
   * distinct-identity reference handle.
   */
  handleFor(config: ReferenceMountConfig): HostSDK {
    const existing = this.#mounts.get(config.mountKey);
    if (existing !== undefined) return existing.sdk;
    const gate = new CapabilityGate(this.#userCapabilities, config.declaredCapabilities);
    const instanceId = mintInstanceId();
    const mount = createReferenceMount({
      instanceId,
      widgetId: config.widgetId,
      gate,
      token: mintInstanceToken(),
      transport: this.#transport,
      bus: this.#bus,
      ...(config.context !== undefined ? { context: config.context } : {}),
      ...(this.#telemetryFor !== undefined
        ? { telemetry: this.#telemetryFor({ instanceId, widgetID: config.widgetId }) }
        : {}),
    });
    this.#mounts.set(config.mountKey, mount);
    return mount.sdk;
  }

  /** The current handle for `mountKey`, or `undefined` if none is live. */
  get(mountKey: string): HostSDK | undefined {
    return this.#mounts.get(mountKey)?.sdk;
  }

  /** Whether a handle is currently held for `mountKey`. */
  has(mountKey: string): boolean {
    return this.#mounts.has(mountKey);
  }

  /**
   * Unmount every mount **not** in `liveKeys` — the mounts the canvas no longer
   * places. Each is `unmount()`-ed (token revoked, subscriptions released, rule 6)
   * and dropped. Returns the keys released. A re-placed key later mints a fresh
   * handle, since a re-mount is a new instance.
   */
  reconcile(liveKeys: Iterable<string>): readonly string[] {
    const live = liveKeys instanceof Set ? liveKeys : new Set(liveKeys);
    const released: string[] = [];
    for (const key of this.#mounts.keys()) {
      if (!live.has(key)) released.push(key);
    }
    for (const key of released) {
      this.#mounts.get(key)!.unmount();
      this.#mounts.delete(key);
    }
    return released;
  }

  /** Unmount and release the handle for a single `mountKey`. Returns whether one was held. */
  release(mountKey: string): boolean {
    const mount = this.#mounts.get(mountKey);
    if (mount === undefined) return false;
    mount.unmount();
    return this.#mounts.delete(mountKey);
  }

  /** Unmount every mount (page torn down or replaced). */
  reset(): void {
    for (const mount of this.#mounts.values()) mount.unmount();
    this.#mounts.clear();
  }

  /** How many mounts currently hold a handle. */
  get size(): number {
    return this.#mounts.size;
  }
}
