import { describe, it, expect } from 'vitest';
import type { WidgetId } from '@gridmason/sdk';
import { toPageContext, demoHostData, type DashboardContext } from './host-data';
import { createInterimHandle } from './interim-handle';

const WIDGET: WidgetId = { source: 'local', tag: 'record-summary' };

describe('toPageContext — dashboard context → protocol PageContext', () => {
  it('keeps a fully-bound record ref', () => {
    const dashboard: DashboardContext = { record: { recordType: 'customer', id: 'cust-42' } };
    expect(toPageContext(dashboard)).toEqual({ record: { recordType: 'customer', id: 'cust-42' } });
  });

  it('drops an unbound record ref (null id) — an entity-less page has no record to read', () => {
    const dashboard: DashboardContext = { record: { recordType: 'customer', id: null } };
    expect(toPageContext(dashboard)).toBeUndefined();
  });

  it('is undefined for a page with no context', () => {
    expect(toPageContext(undefined)).toBeUndefined();
  });
});

describe('demoHostData — Phase-A fixture host data from a page context', () => {
  it('serves a fixture record and grants the read capability for each bound record ref', () => {
    const context = toPageContext({ record: { recordType: 'customer', id: 'cust-42' } });
    const hostData = demoHostData(context);
    expect(hostData).toBeDefined();
    expect(hostData!.capabilities).toContainEqual({ api: 'records.read', scope: 'recordType:customer' });
    expect(hostData!.fixtures.records?.read?.[0]?.ref).toEqual({ recordType: 'customer', id: 'cust-42' });
  });

  it('is undefined when the context binds no record ref', () => {
    expect(demoHostData(undefined)).toBeUndefined();
    expect(demoHostData({})).toBeUndefined();
  });
});

describe('read path end to end — a record-detail page reads its record through the handle', () => {
  it('a demo.record-detail context yields a handle whose records.read returns the demo record', async () => {
    // The value shape `buildPageContext` produces for `/p/demo.record-detail/cust-42`.
    const dashboard: DashboardContext = { record: { recordType: 'customer', id: 'cust-42' } };
    const context = toPageContext(dashboard);
    const hostData = demoHostData(context);

    const sdk = createInterimHandle({
      mountKey: 'summary',
      widgetId: WIDGET,
      ...(context !== undefined ? { context } : {}),
      ...(hostData !== undefined ? { hostData } : {}),
    });

    // The widget reads its ref off `sdk.context.record` and reads it back through the handle.
    const ref = (sdk.context as { record: { recordType: string; id: string } }).record;
    const record = await sdk.records.read(ref);
    expect(record.ref).toEqual({ recordType: 'customer', id: 'cust-42' });
    expect(record.fields.recordType).toBe('customer');
    expect(record.fields.name).toContain('cust-42');
  });
});
