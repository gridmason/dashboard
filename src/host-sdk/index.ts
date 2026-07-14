/**
 * The dashboard's **interim** host-SDK layer (docs/SPEC.md §6, FR-9 — Phase A).
 *
 * The reference, enforcing `HostSDK` host implementation (`min(user, widget)` +
 * remote-identity check, conformance-suite green) is the Phase-B deliverable
 * D-E4. This layer is the Phase-A stand-in that lets the static boot mount
 * widgets with a real, per-instance, fixture/no-op-backed handle in the meantime
 * — swappable for the enforcing backing without a widget-ABI change. See
 * `./interim-handle` for what the handle is and is not.
 */

export {
  createInterimHandle,
  mintInstanceId,
  type HostData,
  type InterimMountInput,
} from './interim-handle';
export { InterimHandleRegistry, type HandleFactory } from './registry';
export { toPageContext, demoHostData, type DashboardContext } from './host-data';
