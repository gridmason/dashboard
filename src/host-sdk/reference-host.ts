/**
 * The dashboard's **reference `HostSDK` implementation** (docs/SPEC.md §3, §6,
 * FR-9/FR-14) — the enforcing handle that replaces the Phase-A interim
 * fixture/no-op stand-in. It is the reference documentation for "a conforming
 * Gridmason host": it passes the `@gridmason/sdk` conformance kit
 * (`conformance.test.ts`) and implements, as reference code, the six SPEC §3
 * contract rules:
 *
 * 1. **`min(user, widget)` before transport.** Every `records`/`net`/`events`
 *    call is checked against the {@link CapabilityGate}; a denial is a thrown/
 *    rejected {@link PermissionDenied}, never an empty result (no leakage).
 * 2. **Net-host scope.** `net.fetch` reaches only hosts the intersection grants.
 * 3. **Per-instance remote identity.** At mount the shell mints an unforgeable
 *    {@link InstanceToken} held in this closure and stamped on every outbound
 *    call via the SDK's {@link bindIdentityStamper}; the stamped binding is
 *    reported through {@link ReferenceMount.lastOutboundIdentity} (the seam the
 *    conformance kit reads, since the token never surfaces on the handle).
 * 4. **Typed, namespaced, capability-gated events** over a host-mediated
 *    {@link HostEventBus} shared across the host's mounts — never a shared global.
 * 5. **Per-instance handles.** Each mount carries its own minted `instanceId`.
 * 6. **Unmount revocation.** {@link ReferenceMount.unmount} revokes the token and
 *    releases every subscription; a stale gated call rejects/throws
 *    {@link InstanceGone}, never hangs, never returns data.
 *
 * The handle holds no data of its own — records/net go through an injected
 * {@link OutboundTransport}, and events through the injected {@link HostEventBus}
 * — so the same enforcing code backs the conformance kit (in-memory transport),
 * the dashboard canvas (local demo transport + server-registered token), and any
 * product shell, unchanged.
 */

import {
  bindIdentityStamper,
  PermissionDenied,
  type HostSDK,
  type InstanceToken,
  type JSONSchema,
  type Notice,
  type Patch,
  type QuerySpec,
  type PageContext,
  type ReadOptions,
  type RecordData,
  type RecordRef,
  type RouteRef,
  type ScopedRequest,
  type ScopedResponse,
  type TypedTopic,
  type Unsubscribe,
  type WidgetError,
  type WidgetId,
  type WidgetSettings,
} from '@gridmason/sdk';
import { createInstanceLifecycle } from '@gridmason/sdk/noop';
import type { Capability } from '@gridmason/protocol';
import {
  CapabilityGate,
  eventsCapability,
  netCapability,
  readCapability,
  writeCapability,
} from './capabilities';
import { HostEventBus } from './event-bus';
import type { OutboundTransport } from './transport';
import type { HostInstanceTelemetry } from '../adapters/telemetry';

/**
 * The remote-identity binding the host stamped on the most recent allowed
 * outbound call (the conformance kit's `RemoteIdentityBinding`): the mount it was
 * attributed to, plus the scoped host for a `net.fetch`.
 */
export interface OutboundIdentity {
  readonly instanceId: string;
  readonly host?: string;
}

/** A mounted reference instance: the handle plus the two out-of-band seams the interface cannot expose. */
export interface ReferenceMount {
  /** The capability-scoped handle the widget receives. */
  readonly sdk: HostSDK;
  /** The identity stamped on the most recent allowed outbound call, or `undefined`. */
  lastOutboundIdentity(): OutboundIdentity | undefined;
  /** Unmount: revoke the token, release subscriptions; stale calls then reject `InstanceGone`. */
  unmount(): void;
}

/** Everything a single reference mount needs. */
export interface ReferenceMountInput {
  readonly instanceId: string;
  readonly widgetId: WidgetId;
  /** The `min(user, widget)` gate this mount enforces. */
  readonly gate: CapabilityGate;
  /** The unforgeable instance token the shell minted (held in this closure only). */
  readonly token: InstanceToken;
  /** The records/net send seam behind the gate. */
  readonly transport: OutboundTransport;
  /** The host-owned event bus, shared across the host's mounts. */
  readonly bus: HostEventBus;
  /** The page context exposed as `sdk.context`; empty when omitted. */
  readonly context?: PageContext;
  /** Initial settings `settings.get()` returns. */
  readonly settings?: WidgetSettings;
  /**
   * The identity-stamped telemetry sink this mount's `sdk.telemetry` forwards to
   * (SPEC §3, FR-15). Already bound to this mount's `(instanceId, widgetId)` by
   * the host, so a widget's `mark`/`error` reach the adapter attributed. Omitted =
   * the no-op default (telemetry accepted and dropped, as in the interim handle).
   */
  readonly telemetry?: HostInstanceTelemetry;
  /** Called after the token is revoked on unmount — lets the shell tear down server-side state. */
  readonly onUnmount?: (instanceId: string) => void;
}

/**
 * Create one enforcing reference mount. See the module doc for the six rules it
 * honors; the returned {@link ReferenceMount} is exactly the shape the
 * conformance kit's `Mount` adapter needs.
 */
export function createReferenceMount(input: ReferenceMountInput): ReferenceMount {
  const { instanceId, widgetId, gate, token, transport, bus } = input;
  const lifecycle = createInstanceLifecycle(instanceId);
  // The token reader stops yielding once revoked, so the stamper refuses a dead
  // instance (SPEC §3 rule 6). The token is captured here and never returned.
  const stamper = bindIdentityStamper(instanceId, () => (lifecycle.revoked ? undefined : token));

  let lastIdentity: OutboundIdentity | undefined;
  const settings: Record<string, unknown> = { ...(input.settings ?? {}) };

  /** Reject a gated async call that arrived on a revoked handle (rule 6). */
  function assertLiveAsync(): void {
    if (lifecycle.revoked) throw lifecycle.gone();
  }

  /** Deny a gated call the intersection does not grant (rule 1). */
  function deny(capability: Capability): never {
    throw new PermissionDenied({ capability, instanceId });
  }

  const records: HostSDK['records'] = {
    async read(ref: RecordRef, opts?: ReadOptions): Promise<RecordData> {
      assertLiveAsync();
      const required = readCapability(ref.recordType);
      if (!gate.allows(required)) deny(required);
      const headers = stamper.stampHeaders();
      lastIdentity = { instanceId };
      return transport.read(ref, opts, headers);
    },
    async query(spec: QuerySpec): Promise<RecordData[]> {
      assertLiveAsync();
      const required = readCapability(spec.recordType);
      if (!gate.allows(required)) deny(required);
      const headers = stamper.stampHeaders();
      lastIdentity = { instanceId };
      return transport.query(spec, headers);
    },
    async write(ref: RecordRef, patch: Patch): Promise<RecordData> {
      assertLiveAsync();
      const required = writeCapability(ref.recordType);
      if (!gate.allows(required)) deny(required);
      const headers = stamper.stampHeaders();
      lastIdentity = { instanceId };
      return transport.write(ref, patch, headers);
    },
  };

  const net: HostSDK['net'] = {
    async fetch(req: ScopedRequest): Promise<ScopedResponse> {
      assertLiveAsync();
      const required = netCapability(req.host);
      if (!gate.allows(required)) deny(required);
      const stamped = stamper.stampRequest(req);
      lastIdentity = { instanceId, host: req.host };
      return transport.fetch(stamped);
    },
  };

  const events: HostSDK['events'] = {
    emit<T>(topic: TypedTopic<T>, payload: T): void {
      lifecycle.assertLive();
      const required = eventsCapability(topic.ns);
      if (!gate.allows(required)) deny(required);
      bus.emit(topic, payload);
    },
    on<T>(topic: TypedTopic<T>, handler: (payload: T) => void): Unsubscribe {
      lifecycle.assertLive();
      const required = eventsCapability(topic.ns);
      if (!gate.allows(required)) deny(required);
      const release = bus.subscribe(topic, handler);
      // Auto-release on unmount (rule 6); the manual Unsubscribe deregisters that
      // teardown so it is not re-run on a later revoke.
      const deregister = lifecycle.onRevoke(release);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
        deregister();
      };
    },
  };

  const sdk: HostSDK = {
    records,
    net,
    events,
    context: input.context ?? {},
    settings: {
      get(): WidgetSettings {
        return { ...settings };
      },
      async update(patch: Partial<WidgetSettings>): Promise<void> {
        assertLiveAsync();
        Object.assign(settings, patch);
      },
      onSchema(_schema: JSONSchema): void {
        lifecycle.assertLive();
        // Reference host renders no settings form yet (SPEC §4 host-rendered form
        // is a later epic); the registration is accepted and dropped.
      },
    },
    nav: {
      open(_target: RouteRef): void {
        lifecycle.assertLive();
        // Reference host owns routing elsewhere; nav is a no-op audit point here.
      },
      toast(_msg: Notice): void {
        lifecycle.assertLive();
      },
    },
    telemetry: {
      error(e: WidgetError): void {
        // Ungated + never throws: telemetry must survive teardown so an unmount
        // error can still be reported. Forward to the identity-stamped host sink
        // (FR-15) when one is wired; otherwise drop (no-op default).
        input.telemetry?.error(e);
      },
      mark(name: string, ms: number): void {
        input.telemetry?.mark(name, ms);
      },
    },
    identity: { instanceId, widgetId },
  };

  return {
    sdk,
    lastOutboundIdentity: () => lastIdentity,
    unmount(): void {
      lifecycle.revoke();
      input.onUnmount?.(instanceId);
    },
  };
}
