import { describe, expect, it } from 'vitest';
import { demoDeclaredCapabilities, toPageContext } from './host-data';

describe('toPageContext', () => {
  it('keeps only fully-bound record refs (non-null id)', () => {
    expect(
      toPageContext({ record: { recordType: 'customer', id: 'cust-42' } }),
    ).toEqual({ record: { recordType: 'customer', id: 'cust-42' } });
  });

  it('drops an unbound ref and returns undefined when nothing binds', () => {
    expect(toPageContext({ record: { recordType: 'customer', id: null } })).toBeUndefined();
    expect(toPageContext(undefined)).toBeUndefined();
  });
});

describe('demoDeclaredCapabilities', () => {
  it('derives one records.read scope per bound record type', () => {
    expect(demoDeclaredCapabilities({ record: { recordType: 'customer', id: 'cust-42' } })).toEqual([
      { api: 'records.read', scope: 'recordType:customer' },
    ]);
  });

  it('is empty for a context that binds no record ref', () => {
    expect(demoDeclaredCapabilities(undefined)).toEqual([]);
    expect(demoDeclaredCapabilities({})).toEqual([]);
  });

  it('de-duplicates repeated record types', () => {
    const caps = demoDeclaredCapabilities({
      a: { recordType: 'customer', id: 'c1' },
      b: { recordType: 'customer', id: 'c2' },
    });
    expect(caps).toEqual([{ api: 'records.read', scope: 'recordType:customer' }]);
  });
});
