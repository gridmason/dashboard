import { describe, expect, it } from 'vitest';
import { readRecordRef } from './record';

describe('readRecordRef', () => {
  it('extracts a record-ref value from page context', () => {
    expect(readRecordRef({ record: { recordType: 'customer', id: 'cust-42' } })).toEqual({
      recordType: 'customer',
      id: 'cust-42',
    });
  });

  it('accepts a null id (entity-less route)', () => {
    expect(readRecordRef({ record: { recordType: 'customer', id: null } })).toEqual({
      recordType: 'customer',
      id: null,
    });
  });

  it('is slot-name agnostic — takes the first record-shaped entry', () => {
    expect(readRecordRef({ subject: { recordType: 'team', id: 't-9' } })?.recordType).toBe('team');
  });

  it('returns undefined for absent / null / non-record context', () => {
    expect(readRecordRef(undefined)).toBeUndefined();
    expect(readRecordRef(null)).toBeUndefined();
    expect(readRecordRef({})).toBeUndefined();
    expect(readRecordRef({ record: { name: 'no type' } })).toBeUndefined();
    expect(readRecordRef({ record: { recordType: 42, id: 'x' } })).toBeUndefined();
  });
});
