/**
 * The dashboard's **reference host-SDK layer** (docs/SPEC.md §3, §6, FR-9/FR-14).
 *
 * The enforcing `HostSDK` reference implementation: the capability chokepoint that
 * runs `min(user, widget)` before transport, stamps the per-instance remote
 * identity on every outbound call, mediates a host-owned event bus, and revokes on
 * unmount — passing the `@gridmason/sdk` conformance kit. It replaces the Phase-A
 * interim fixture/no-op handle behind the same seam the canvas assigns onto each
 * widget element, so the widget ABI is unchanged. See `./reference-host` for the
 * handle and `./reference-registry` for the per-canvas mount lifecycle.
 */

export {
  createReferenceMount,
  type OutboundIdentity,
  type ReferenceMount,
  type ReferenceMountInput,
} from './reference-host';
export {
  ReferenceHostRegistry,
  type ReferenceMountConfig,
  type ReferenceHostRegistryOptions,
} from './reference-registry';
export { CapabilityGate, readCapability, writeCapability, netCapability, eventsCapability } from './capabilities';
export { HostEventBus } from './event-bus';
export { mintInstanceId, mintInstanceToken } from './mint';
export {
  LocalDemoTransport,
  scopedResponse,
  type OutboundTransport,
} from './transport';
export { toPageContext, demoDeclaredCapabilities, type DashboardContext } from './host-data';
