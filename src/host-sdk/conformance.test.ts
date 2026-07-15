/**
 * The `@gridmason/sdk` **host-conformance kit** run against the dashboard's
 * reference `HostSDK` implementation (docs/SPEC.md §5, §6, FR-9). Passing every
 * check is the definition of "a valid Gridmason host": it mechanically asserts all
 * six SPEC §3 contract rules — `min(user, widget)` before transport with typed
 * denial, net-host scoping, per-instance remote-identity binding, typed/namespaced
 * capability-gated events, per-instance isolation, and unmount revocation.
 *
 * The kit is host-agnostic: it drives a {@link ConformanceHost} adapter that mounts
 * a widget for a scenario and surfaces the two seams the interface cannot expose —
 * the stamped remote identity (rule 3) and unmount (rule 6). {@link createReferenceMount}
 * returns exactly that shape, so the adapter is a thin wrapper: build the
 * `min(user, widget)` gate from the requested capability pair, mint the instance
 * identity/token, and share one host-owned event bus across mounts (rule 4 needs
 * two co-mounted widgets to talk through the host).
 */

import { runHostConformance } from '@gridmason/sdk/conformance';
import type { ConformanceHost } from '@gridmason/sdk/conformance';
import { CapabilityGate } from './capabilities';
import { HostEventBus } from './event-bus';
import { mintInstanceId, mintInstanceToken } from './mint';
import { createReferenceMount } from './reference-host';
import { LocalDemoTransport } from './transport';

/** One host-under-test: a shared bus + transport, and a mount per conformance scenario. */
const referenceHost: ConformanceHost = (() => {
  // The event bus is shared across mounts so a co-mounted emitter/subscriber pair
  // communicate through the host (rule 4) — never a shared global.
  const bus = new HostEventBus();
  const transport = new LocalDemoTransport();
  return {
    name: 'dashboard reference host',
    mount(request) {
      const gate = new CapabilityGate(request.userCapabilities, request.widgetCapabilities);
      return createReferenceMount({
        instanceId: mintInstanceId(),
        widgetId: request.widgetId,
        gate,
        token: mintInstanceToken(),
        transport,
        bus,
        ...(request.context !== undefined ? { context: request.context } : {}),
      });
    },
  };
})();

runHostConformance(referenceHost);
