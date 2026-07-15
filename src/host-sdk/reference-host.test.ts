import { describe, expect, it } from 'vitest';
import { isInstanceGone, isPermissionDenied, type WidgetId } from '@gridmason/sdk';
import { CapabilityGate } from './capabilities';
import { HostEventBus } from './event-bus';
import { mintInstanceToken } from './mint';
import { createReferenceMount, type ReferenceMountInput } from './reference-host';
import { LocalDemoTransport } from './transport';

const WIDGET: WidgetId = { source: 'local', tag: 'gm-test-widget' };

function mount(overrides: Partial<ReferenceMountInput> = {}) {
  const bus = overrides.bus ?? new HostEventBus();
  return createReferenceMount({
    instanceId: overrides.instanceId ?? 'inst-1',
    widgetId: WIDGET,
    gate: overrides.gate ?? new CapabilityGate(['records.read', 'net', 'events'], ['records.read:recordType:customer', 'net:api.acme.com', 'events:acme.sales']),
    token: overrides.token ?? mintInstanceToken(),
    transport: overrides.transport ?? new LocalDemoTransport(),
    bus,
    ...overrides,
  });
}

describe('reference host — rule 1 (min(user, widget), typed denial)', () => {
  it('resolves a granted records.read (never an empty leak)', async () => {
    const { sdk } = mount();
    const record = await sdk.records.read({ recordType: 'customer', id: 'c1' });
    expect(record.fields.name).toContain('c1');
  });

  it('rejects an ungranted records.read with a typed PermissionDenied', async () => {
    const { sdk } = mount();
    const outcome = await sdk.records.read({ recordType: 'order', id: 'o1' }).then(
      (v) => ({ ok: true, v }) as const,
      (e) => ({ ok: false, e }) as const,
    );
    expect(outcome.ok).toBe(false);
    expect(isPermissionDenied((outcome as { e: unknown }).e)).toBe(true);
  });

  it('intersects: a user narrower than the widget is enforced', async () => {
    const gate = new CapabilityGate(['records.read:recordType:customer'], ['records.read']);
    const { sdk } = mount({ gate });
    await expect(sdk.records.read({ recordType: 'customer', id: 'c1' })).resolves.toBeDefined();
    await expect(sdk.records.read({ recordType: 'order', id: 'o1' })).rejects.toSatisfy(isPermissionDenied);
  });
});

describe('reference host — rule 2 (net-host scope) + rule 3 (identity binding)', () => {
  it('reaches a declared host and stamps the per-instance identity', async () => {
    const m = mount({ instanceId: 'inst-net' });
    const res = await m.sdk.net.fetch({ host: 'api.acme.com', path: '/v2/sales' });
    expect(res.ok).toBe(true);
    expect(m.lastOutboundIdentity()).toEqual({ instanceId: 'inst-net', host: 'api.acme.com' });
  });

  it('denies an undeclared host with PermissionDenied and stamps no binding', async () => {
    const m = mount({ instanceId: 'inst-net' });
    await expect(m.sdk.net.fetch({ host: 'evil.example', path: '/exfil' })).rejects.toSatisfy(isPermissionDenied);
    expect(m.lastOutboundIdentity()).toBeUndefined();
  });

  it('stamps identity on an allowed records.read too', async () => {
    const m = mount({ instanceId: 'inst-rec' });
    await m.sdk.records.read({ recordType: 'customer', id: 'c1' });
    expect(m.lastOutboundIdentity()).toEqual({ instanceId: 'inst-rec' });
  });
});

describe('reference host — rule 6 (unmount revocation)', () => {
  it('rejects a stale records call with InstanceGone', async () => {
    const m = mount();
    m.unmount();
    await expect(m.sdk.records.read({ recordType: 'customer', id: 'c1' })).rejects.toSatisfy(isInstanceGone);
  });

  it('throws InstanceGone on a stale synchronous events call', () => {
    const m = mount();
    m.unmount();
    expect(() => m.sdk.events.emit({ ns: 'acme.sales', name: 'x' }, {})).toThrow();
    const err = (() => {
      try {
        m.sdk.events.emit({ ns: 'acme.sales', name: 'x' }, {});
      } catch (e) {
        return e;
      }
    })();
    expect(isInstanceGone(err)).toBe(true);
  });

  it('auto-unsubscribes: a released handler receives no later emission', () => {
    const bus = new HostEventBus();
    const subscriber = mount({ bus, instanceId: 'sub' });
    const emitter = mount({ bus, instanceId: 'emit' });
    const got: unknown[] = [];
    subscriber.sdk.events.on({ ns: 'acme.sales', name: 'selected' }, (p) => got.push(p));
    subscriber.unmount();
    emitter.sdk.events.emit({ ns: 'acme.sales', name: 'selected' }, { id: 'after' });
    expect(got).toEqual([]);
  });
});

describe('reference host — the instance token is never exposed on the handle', () => {
  it('has no member carrying the minted token', () => {
    const token = mintInstanceToken();
    const { sdk } = mount({ token });
    // The token lives only in the transport closure — not on identity, not anywhere reachable.
    expect(JSON.stringify(sdk.identity)).not.toContain(token);
    expect(Object.values(sdk.identity)).not.toContain(token as string);
  });
});
