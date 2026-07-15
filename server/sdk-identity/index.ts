/**
 * The reference **instance-token identity rail** (docs/SPEC.md §2, §3, §6; FR-14)
 * — the server half of the per-remote identity binding the reference `HostSDK`
 * stamps client-side. This is reference enforcement code: it makes the SPEC §3
 * token claims true end to end, so a widget that bypasses the SDK is denied on
 * every capability-gated route.
 *
 * The rail (SPEC §3, "per-remote identity rides a separate rail"):
 *
 * 1. At mount the shell mints an unforgeable per-instance token and **registers**
 *    it here with `(instanceId, widgetId, declared capabilities)` under the
 *    caller's session — {@link InstanceTokenRegistry.register}.
 * 2. The SDK transport stamps that token under {@link INSTANCE_TOKEN_HEADER} on
 *    every outbound `records`/`net` call; a capability-gated route resolves the
 *    header to its binding and enforces `min(user, declared-widget)` —
 *    {@link enforceInstanceCapability}.
 * 3. A call carrying **no** valid instance token is an anonymous page script (a
 *    widget that reached the API around the SDK): it holds the session but not the
 *    closure token, so every capability-gated route denies it (`instance_required`).
 * 4. On unmount the shell revokes the token — {@link InstanceTokenRegistry.revoke}.
 *
 * Honest framing (SPEC §3): same-document JS is no hard isolation boundary, so a
 * page script *can* register its own token — but only under its own session, and
 * `min(user, widget)` caps it at the user's own capabilities, so it can never
 * escalate past what the user already holds. The rail is enforcement plumbing plus
 * an audit trail, not a sandbox.
 *
 * {@link enforceInstanceCapability} is exported as **reusable middleware**: the
 * scoped-fetch proxy endpoint (D-E4.2, #20) applies the identical decision to a
 * `net:<host>` call, so both channels enforce one rule.
 */

import { formatCapability, grantsCapability, parseCapability, type Capability } from '@gridmason/protocol';
import type { WidgetID } from '@gridmason/protocol';
import type { SessionUser } from '../auth/index';

/** The transport header the per-instance token rides under (mirrors `@gridmason/sdk`). */
export const INSTANCE_TOKEN_HEADER = 'x-gridmason-instance-token';

/** A registered per-instance binding: the token mapped to its mount, widget, owner, and declared caps. */
export interface InstanceBinding {
  /** The opaque instance token (the map key). */
  readonly token: string;
  /** The public per-mount id (`identity.instanceId`). */
  readonly instanceId: string;
  /** The `(source, tag)` widget this token was minted for. */
  readonly widgetId: WidgetID;
  /** The session user that registered the token — a token is usable only under its own session. */
  readonly userId: string;
  /** The widget's declared capabilities — the `widget` side of `min(user, widget)`. */
  readonly declaredCapabilities: readonly Capability[];
}

/** Input to {@link InstanceTokenRegistry.register}. */
export interface RegisterInstanceInput {
  readonly token: string;
  readonly instanceId: string;
  readonly widgetId: WidgetID;
  readonly userId: string;
  readonly declaredCapabilities: readonly Capability[];
}

/**
 * In-memory instance-token → binding map. Single-tenant, process-lifetime (dropped
 * on restart — correct for the demo; a real host persists/expires tokens). A token
 * is unforgeable *randomness* the shell minted, so the map key is the secret.
 */
export class InstanceTokenRegistry {
  readonly #byToken = new Map<string, InstanceBinding>();

  /** Register (or replace) the binding for `input.token`. Returns the stored binding. */
  register(input: RegisterInstanceInput): InstanceBinding {
    const binding: InstanceBinding = {
      token: input.token,
      instanceId: input.instanceId,
      widgetId: input.widgetId,
      userId: input.userId,
      declaredCapabilities: [...input.declaredCapabilities],
    };
    this.#byToken.set(input.token, binding);
    return binding;
  }

  /** The binding for `token`, or `undefined` if unknown/revoked. */
  resolve(token: string | undefined): InstanceBinding | undefined {
    if (token === undefined || token === '') return undefined;
    return this.#byToken.get(token);
  }

  /** Revoke a token (unmount). Returns whether one was held. */
  revoke(token: string | undefined): boolean {
    if (token === undefined) return false;
    return this.#byToken.delete(token);
  }

  /** How many bindings are live. */
  get size(): number {
    return this.#byToken.size;
  }
}

/** Why a capability-gated call was denied. */
export type EnforcementDenial =
  /** No valid instance token on the call — the caller bypassed the SDK (SPEC §3). */
  | { readonly kind: 'instance_required'; readonly status: 403 }
  /** The token exists but belongs to a different session — it cannot be replayed cross-session. */
  | { readonly kind: 'instance_foreign'; readonly status: 403 }
  /** `min(user, widget)` did not grant the required capability (SPEC §3 rule 1). */
  | { readonly kind: 'permission_denied'; readonly status: 403; readonly capability: Capability };

/** The result of an enforcement decision. */
export type EnforcementResult =
  | { readonly ok: true; readonly binding: InstanceBinding }
  | { readonly ok: false; readonly denial: EnforcementDenial };

/** Parse a capability string to its object form, or `undefined` if malformed. */
export function parseCapabilityString(input: string): Capability | undefined {
  const parsed = parseCapability(input);
  if (!parsed.ok) return undefined;
  return parsed.scope === undefined ? { api: parsed.api } : { api: parsed.api, scope: parsed.scope };
}

/** `true` iff some capability in `set` grants `required` (scope-prefix containment). */
function grantedBy(set: readonly Capability[], required: Capability): boolean {
  return set.some((cap) => grantsCapability(cap, required));
}

/**
 * Enforce a capability-gated call against the instance-token rail — the reusable
 * middleware (SPEC §3, §6). Denies, in order:
 *
 * 1. **`instance_required`** — no resolvable instance token: a call that reached
 *    the API around the SDK (session auth, no closure token) is an anonymous page
 *    script and is denied on every capability-gated route.
 * 2. **`instance_foreign`** — the token resolves but was registered under a
 *    different session; a token is bound to its minting session and never replayable.
 * 3. **`permission_denied`** — `min(user, declared-widget)` does not grant
 *    `required`: either the user lacks it or the widget never declared it.
 *
 * On success returns the resolved binding (for audit/attribution). The user's
 * capabilities come from the session (`SessionUser.capabilities`); the widget's
 * from the registered binding — their intersection is the enforced grant.
 */
export function enforceInstanceCapability(opts: {
  readonly registry: InstanceTokenRegistry;
  readonly token: string | undefined;
  readonly user: SessionUser;
  readonly required: Capability;
}): EnforcementResult {
  const binding = opts.registry.resolve(opts.token);
  if (binding === undefined) {
    return { ok: false, denial: { kind: 'instance_required', status: 403 } };
  }
  if (binding.userId !== opts.user.id) {
    return { ok: false, denial: { kind: 'instance_foreign', status: 403 } };
  }
  const userCaps = opts.user.capabilities
    .map(parseCapabilityString)
    .filter((c): c is Capability => c !== undefined);
  const grantedByUser = grantedBy(userCaps, opts.required);
  const grantedByWidget = grantedBy(binding.declaredCapabilities, opts.required);
  if (!grantedByUser || !grantedByWidget) {
    return { ok: false, denial: { kind: 'permission_denied', status: 403, capability: opts.required } };
  }
  return { ok: true, binding };
}

/** The JSON error body for a denial — a typed shape the client transport maps to `PermissionDenied`. */
export function denialBody(denial: EnforcementDenial): { error: string; capability?: string } {
  if (denial.kind === 'permission_denied') {
    return { error: 'permission_denied', capability: formatCapability(denial.capability) };
  }
  return { error: denial.kind };
}
