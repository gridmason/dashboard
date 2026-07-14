import { describe, it, expect } from 'vitest';
import { isNoopSDK } from '@gridmason/sdk/noop';
import { isFixtureSDK } from '@gridmason/sdk/fixture';
import type { WidgetId } from '@gridmason/sdk';
import { createInterimHandle, mintInstanceId, type HostData } from './interim-handle';

const WIDGET: WidgetId = { source: 'local', tag: 'record-summary' };

/** The host data a `demo.record-detail` mount carries: one customer record + its read capability. */
function customerHostData(id: string): HostData {
  return {
    fixtures: {
      records: {
        read: [{ ref: { recordType: 'customer', id }, fields: { name: `Customer ${id}` } }],
      },
    },
    capabilities: [{ api: 'records.read', scope: 'recordType:customer' }],
  };
}

describe('mintInstanceId', () => {
  it('mints distinct, non-empty ids on each call', () => {
    const ids = new Set([mintInstanceId(), mintInstanceId(), mintInstanceId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });
});

describe('createInterimHandle — the reference HostSDK shape (FR-9, Phase A)', () => {
  it('reads a context record THROUGH the handle (fixture-backed), not around it', async () => {
    const ref = { recordType: 'customer', id: 'cust-42' } as const;
    const sdk = createInterimHandle({
      mountKey: 'summary',
      widgetId: WIDGET,
      context: { record: ref },
      hostData: customerHostData('cust-42'),
    });

    const record = await sdk.records.read(ref);
    expect(record.ref).toEqual(ref);
    expect(record.fields).toEqual({ name: 'Customer cust-42' });
    // The same ref the widget reads off its context (`sdk.context.record`) is the
    // one it passes to `records.read` — the intended widget→host path.
    expect(sdk.context).toEqual({ record: ref });
  });

  it('is fixture-backed (a dev handle, not an enforcing host) when given host data', () => {
    const sdk = createInterimHandle({
      mountKey: 'summary',
      widgetId: WIDGET,
      hostData: customerHostData('c1'),
    });
    expect(isFixtureSDK(sdk)).toBe(true);
  });

  it('is no-op-backed with empty typed defaults when the mount has no host data', async () => {
    const sdk = createInterimHandle({ mountKey: 'clock', widgetId: WIDGET });
    expect(isNoopSDK(sdk)).toBe(true);
    // No fixture: a read resolves to an empty typed default rather than denying.
    const record = await sdk.records.read({ recordType: 'customer', id: 'x' });
    expect(record.fields).toEqual({});
    await expect(sdk.records.query({ recordType: 'customer' })).resolves.toEqual([]);
  });

  it('carries the widget identity it was minted for', () => {
    const sdk = createInterimHandle({ mountKey: 'summary', widgetId: WIDGET });
    expect(sdk.identity.widgetId).toEqual(WIDGET);
    expect(sdk.identity.instanceId.length).toBeGreaterThan(0);
  });

  it('mints a DISTINCT identity per mount — two instances of the same widget differ', () => {
    const a = createInterimHandle({ mountKey: 'summary', widgetId: WIDGET });
    const b = createInterimHandle({ mountKey: 'metrics', widgetId: WIDGET });
    expect(a.identity.instanceId).not.toBe(b.identity.instanceId);
    // Same widget identity, distinct per-instance identity (SPEC §3 rule 5).
    expect(a.identity.widgetId).toEqual(b.identity.widgetId);
  });
});
