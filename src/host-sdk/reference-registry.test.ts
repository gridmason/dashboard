import { describe, expect, it } from 'vitest';
import { isInstanceGone, type WidgetId } from '@gridmason/sdk';
import type { Capability } from '@gridmason/protocol';
import { ReferenceHostRegistry, type ReferenceMountConfig } from './reference-registry';

const WIDGET: WidgetId = { source: 'local', tag: 'gm-test-widget' };
const CUSTOMER_READ: Capability[] = [{ api: 'records.read', scope: 'recordType:customer' }];

function config(mountKey: string, declared: Capability[] = CUSTOMER_READ): ReferenceMountConfig {
  return { mountKey, widgetId: WIDGET, declaredCapabilities: declared };
}

describe('ReferenceHostRegistry', () => {
  it('mints a distinct handle per mount', () => {
    const registry = new ReferenceHostRegistry();
    const a = registry.handleFor(config('a'));
    const b = registry.handleFor(config('b'));
    expect(a.identity.instanceId).not.toBe(b.identity.instanceId);
    expect(registry.size).toBe(2);
  });

  it('returns the same handle across re-renders (stable identity)', () => {
    const registry = new ReferenceHostRegistry();
    const first = registry.handleFor(config('a'));
    const again = registry.handleFor(config('a'));
    expect(again).toBe(first);
    expect(again.identity.instanceId).toBe(first.identity.instanceId);
  });

  it('reconcile unmounts dropped mounts so their stale handle rejects InstanceGone', async () => {
    const registry = new ReferenceHostRegistry();
    const handle = registry.handleFor(config('a'));
    registry.handleFor(config('b'));
    const released = registry.reconcile(['b']);
    expect(released).toEqual(['a']);
    expect(registry.has('a')).toBe(false);
    await expect(handle.records.read({ recordType: 'customer', id: 'c1' })).rejects.toSatisfy(isInstanceGone);
  });

  it('the single-tenant demo owner grants the widget its declared reads', async () => {
    const registry = new ReferenceHostRegistry();
    const handle = registry.handleFor(config('a'));
    // min(owner-full, widget-declared) = declared → the customer read resolves.
    await expect(handle.records.read({ recordType: 'customer', id: 'cust-42' })).resolves.toMatchObject({
      fields: { name: expect.stringContaining('cust-42') },
    });
    // A type the widget never declared is still denied, even for the full-access owner.
    await expect(handle.records.read({ recordType: 'order', id: 'o1' })).rejects.toBeDefined();
  });

  it('reset unmounts every handle', async () => {
    const registry = new ReferenceHostRegistry();
    const handle = registry.handleFor(config('a'));
    registry.reset();
    expect(registry.size).toBe(0);
    await expect(handle.records.read({ recordType: 'customer', id: 'c1' })).rejects.toSatisfy(isInstanceGone);
  });

  it('shares one event bus across the page mounts', () => {
    const registry = new ReferenceHostRegistry();
    const eventsCap: Capability[] = [{ api: 'events', scope: 'acme.sales' }];
    const sub = registry.handleFor(config('sub', eventsCap));
    const emit = registry.handleFor(config('emit', eventsCap));
    const got: unknown[] = [];
    sub.events.on({ ns: 'acme.sales', name: 'selected' }, (p) => got.push(p));
    emit.events.emit({ ns: 'acme.sales', name: 'selected' }, { id: 's1' });
    expect(got).toEqual([{ id: 's1' }]);
  });
});
