import { describe, expect, it } from 'vitest';
import { getPageType } from './page-types';
import { buildPageContext } from './context';

describe('buildPageContext (SPEC §3, §5)', () => {
  const recordDetail = getPageType('demo.record-detail')!;

  it('binds a record-ref slot to the route entity id', () => {
    expect(buildPageContext(recordDetail, 'cust-42')).toEqual({
      record: { recordType: 'customer', id: 'cust-42' },
    });
  });

  it('provides a null-id record-ref when the page is not entity-scoped', () => {
    expect(buildPageContext(recordDetail)).toEqual({
      record: { recordType: 'customer', id: null },
    });
  });

  it('provides no context for a page type that declares none', () => {
    expect(buildPageContext(getPageType('dashboards.home')!, 'ignored')).toBeUndefined();
    expect(buildPageContext(getPageType('demo.locked')!)).toBeUndefined();
    expect(buildPageContext(getPageType('demo.full-canvas')!)).toBeUndefined();
  });
});
