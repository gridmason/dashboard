/**
 * The `min(user, widget-capability)` gate the reference host enforces before any
 * `records`/`net`/`events` transport (docs/SPEC.md §3 rule 1, §6, FR-9).
 *
 * A capability call is permitted only when **both** sides grant it: the acting
 * user's granted capabilities *and* the widget's declared capabilities. That is
 * the `min(user, widget)` intersection — the host trusts neither the widget's
 * manifest declaration alone (a widget cannot self-grant beyond the user) nor the
 * user's grant alone (the user cannot exercise a capability the widget never
 * declared). The one definition of the containment rule lives in
 * `@gridmason/protocol` (`grantsCapability`, scope-prefix semantics); this module
 * only combines the two sides so both the client handle (rule 1, before
 * transport) and the server (defence in depth) apply the identical decision.
 */

import {
  formatCapability,
  grantsCapability,
  validateCapability,
  type Capability,
} from '@gridmason/protocol';

/** The v1 capability the four gated call kinds require, in object form. */
export function readCapability(recordType: string): Capability {
  return { api: 'records.read', scope: `recordType:${recordType}` };
}
export function writeCapability(recordType: string): Capability {
  return { api: 'records.write', scope: `recordType:${recordType}` };
}
export function netCapability(host: string): Capability {
  return { api: 'net', scope: host };
}
export function eventsCapability(ns: string): Capability {
  return { api: 'events', scope: ns };
}

/**
 * Parse a capability given in either the object form (a manifest carries it) or
 * the ergonomic string form (`'records.read:recordType:customer'`, used by tests
 * and the conformance kit's `MountRequest`). Invalid input throws so a bad grant
 * surfaces at construction, never as a silent deny later.
 */
export function toCapability(input: Capability | string): Capability {
  if (typeof input !== 'string') {
    const err = validateCapability(input);
    if (err !== undefined) throw new Error(`invalid capability ${JSON.stringify(input)}: ${err}`);
    return input;
  }
  const firstColon = input.indexOf(':');
  const api = firstColon === -1 ? input : input.slice(0, firstColon);
  const scope = firstColon === -1 ? undefined : input.slice(firstColon + 1);
  const capability: Capability = scope === undefined ? { api: api as Capability['api'] } : { api: api as Capability['api'], scope };
  const err = validateCapability(capability);
  if (err !== undefined) throw new Error(`invalid capability "${input}": ${err}`);
  return capability;
}

/** Normalize a mixed list of object/string capabilities to validated {@link Capability} objects. */
export function toCapabilities(list: ReadonlyArray<Capability | string>): Capability[] {
  return list.map(toCapability);
}

/** `true` iff some declared capability in `set` grants `required` (scope-prefix containment). */
function granted(set: readonly Capability[], required: Capability): boolean {
  return set.some((cap) => grantsCapability(cap, required));
}

/**
 * The `min(user, widget)` decision for one mount. Constructed with the user's
 * granted capabilities and the widget's declared capabilities; {@link allows}
 * permits a required capability only when **both** sides grant it.
 */
export class CapabilityGate {
  readonly #user: readonly Capability[];
  readonly #widget: readonly Capability[];

  constructor(user: ReadonlyArray<Capability | string>, widget: ReadonlyArray<Capability | string>) {
    this.#user = toCapabilities(user);
    this.#widget = toCapabilities(widget);
  }

  /** Whether `min(user, widget)` grants `required` — both sides must contain it. */
  allows(required: Capability): boolean {
    return granted(this.#user, required) && granted(this.#widget, required);
  }

  /** The widget's declared capabilities (the manifest subset), for audit/telemetry. */
  get widgetCapabilities(): readonly Capability[] {
    return this.#widget;
  }
}

/** Render a capability object for a log/error message. */
export function describeCapability(capability: Capability): string {
  return formatCapability(capability);
}
