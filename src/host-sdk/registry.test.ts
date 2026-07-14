import { describe, it, expect, vi } from 'vitest';
import type { HostSDK, WidgetId } from '@gridmason/sdk';
import { InterimHandleRegistry } from './registry';
import { createInterimHandle, type InterimMountInput } from './interim-handle';

const WIDGET: WidgetId = { source: 'local', tag: 'record-summary' };

describe('InterimHandleRegistry — per-mount handle factory (SPEC §2, §3 rule 5)', () => {
  it('mints a distinct handle+identity per mount key', () => {
    const registry = new InterimHandleRegistry();
    const a = registry.handleFor({ mountKey: 'summary', widgetId: WIDGET });
    const b = registry.handleFor({ mountKey: 'metrics', widgetId: WIDGET });
    expect(a).not.toBe(b);
    expect(a.identity.instanceId).not.toBe(b.identity.instanceId);
  });

  it('returns the SAME handle for a live mount key — stable identity across re-renders', () => {
    const registry = new InterimHandleRegistry();
    const first = registry.handleFor({ mountKey: 'summary', widgetId: WIDGET });
    const second = registry.handleFor({ mountKey: 'summary', widgetId: WIDGET });
    expect(second).toBe(first);
    expect(second.identity.instanceId).toBe(first.identity.instanceId);
  });

  it('mints once per key — a re-render does not re-mint', () => {
    const factory = vi.fn(createInterimHandle);
    const registry = new InterimHandleRegistry(factory);
    registry.handleFor({ mountKey: 'summary', widgetId: WIDGET });
    registry.handleFor({ mountKey: 'summary', widgetId: WIDGET });
    registry.handleFor({ mountKey: 'metrics', widgetId: WIDGET });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('reconcile releases handles for mounts no longer placed (unmount → token drop)', () => {
    const registry = new InterimHandleRegistry();
    registry.handleFor({ mountKey: 'summary', widgetId: WIDGET });
    registry.handleFor({ mountKey: 'metrics', widgetId: WIDGET });
    const released = registry.reconcile(['summary']);
    expect(released).toEqual(['metrics']);
    expect(registry.has('metrics')).toBe(false);
    expect(registry.has('summary')).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('a re-placed key after release mints a FRESH identity (a re-mount is a new instance)', () => {
    const registry = new InterimHandleRegistry();
    const before = registry.handleFor({ mountKey: 'summary', widgetId: WIDGET }).identity.instanceId;
    registry.reconcile([]); // unmounted
    const after = registry.handleFor({ mountKey: 'summary', widgetId: WIDGET }).identity.instanceId;
    expect(after).not.toBe(before);
  });

  it('reset drops every handle', () => {
    const registry = new InterimHandleRegistry();
    registry.handleFor({ mountKey: 'a', widgetId: WIDGET });
    registry.handleFor({ mountKey: 'b', widgetId: WIDGET });
    registry.reset();
    expect(registry.size).toBe(0);
  });

  it('passes the mount input through to the factory verbatim', () => {
    const seen: InterimMountInput[] = [];
    const stub: HostSDK = createInterimHandle({ mountKey: 'probe', widgetId: WIDGET });
    const registry = new InterimHandleRegistry((input) => {
      seen.push(input);
      return stub;
    });
    const input: InterimMountInput = { mountKey: 'summary', widgetId: WIDGET, context: { record: { recordType: 'customer', id: 'c1' } } };
    registry.handleFor(input);
    expect(seen).toEqual([input]);
  });
});
