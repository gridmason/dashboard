/**
 * Contract guard for the per-instance token header (SPEC §3; FR-14). The header
 * the SDK identity stamper writes client-side and the header every server reader
 * (this rail + the scoped-fetch proxy) matches on **must** be the one pinned
 * literal in `@gridmason/sdk@0.4.0` — a divergent value silently drops every token
 * (the read never finds it), so this asserts the constants are the sdk export, not
 * a re-declared literal that could drift.
 */
import { describe, expect, it } from 'vitest';
import { INSTANCE_TOKEN_HEADER as SDK_HEADER } from '@gridmason/sdk';
import { INSTANCE_TOKEN_HEADER as IDENTITY_HEADER } from './index';
import { INSTANCE_TOKEN_HEADER as SCOPED_FETCH_HEADER } from '../scoped-fetch/index';

describe('instance-token header contract', () => {
  it('the sdk pins the canonical lower-case slot', () => {
    expect(SDK_HEADER).toBe('x-gridmason-instance-token');
  });

  it('the identity rail re-exports the sdk constant (not a divergent literal)', () => {
    expect(IDENTITY_HEADER).toBe(SDK_HEADER);
  });

  it('the scoped-fetch proxy reads the same sdk-pinned header', () => {
    expect(SCOPED_FETCH_HEADER).toBe(SDK_HEADER);
  });
});
