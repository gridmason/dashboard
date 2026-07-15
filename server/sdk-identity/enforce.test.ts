import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth/index';
import {
  denialBody,
  enforceInstanceCapability,
  InstanceTokenRegistry,
  parseCapabilityString,
} from './index';

const WIDGET = { source: 'local', tag: 'w' };
const alice: SessionUser = { id: 'alice', username: 'alice', roles: ['admin'], capabilities: ['records.read'] };

function registry(): InstanceTokenRegistry {
  const r = new InstanceTokenRegistry();
  r.register({
    token: 'itk_1',
    instanceId: 'inst-1',
    userId: 'alice',
    widgetId: WIDGET,
    declaredCapabilities: [{ api: 'records.read', scope: 'recordType:customer' }],
  });
  return r;
}

describe('parseCapabilityString', () => {
  it('parses valid strings and rejects invalid ones', () => {
    expect(parseCapabilityString('records.read:recordType:customer')).toEqual({
      api: 'records.read',
      scope: 'recordType:customer',
    });
    expect(parseCapabilityString('net')).toEqual({ api: 'net' });
    expect(parseCapabilityString('bogus')).toBeUndefined();
  });
});

describe('enforceInstanceCapability', () => {
  it('denies instance_required when no token resolves', () => {
    const result = enforceInstanceCapability({
      registry: registry(),
      token: undefined,
      user: alice,
      required: { api: 'records.read', scope: 'recordType:customer' },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.denial.kind).toBe('instance_required');
  });

  it('denies instance_foreign when the token belongs to another user', () => {
    const bob: SessionUser = { ...alice, id: 'bob' };
    const result = enforceInstanceCapability({
      registry: registry(),
      token: 'itk_1',
      user: bob,
      required: { api: 'records.read', scope: 'recordType:customer' },
    });
    expect(result.ok === false && result.denial.kind).toBe('instance_foreign');
  });

  it('allows a capability both the user and the widget grant', () => {
    const result = enforceInstanceCapability({
      registry: registry(),
      token: 'itk_1',
      user: alice,
      required: { api: 'records.read', scope: 'recordType:customer' },
    });
    expect(result.ok).toBe(true);
  });

  it('denies permission_denied when the widget did not declare it', () => {
    const result = enforceInstanceCapability({
      registry: registry(),
      token: 'itk_1',
      user: alice, // user grants all reads
      required: { api: 'records.read', scope: 'recordType:order' }, // widget declared only customer
    });
    expect(result.ok === false && result.denial.kind).toBe('permission_denied');
    expect(result.ok === false && denialBody(result.denial)).toEqual({
      error: 'permission_denied',
      capability: 'records.read:recordType:order',
    });
  });

  it('denies permission_denied when the user lacks it', () => {
    const r = new InstanceTokenRegistry();
    r.register({
      token: 'itk_2',
      instanceId: 'inst-2',
      userId: 'alice',
      widgetId: WIDGET,
      declaredCapabilities: [{ api: 'records.write', scope: 'recordType:customer' }],
    });
    const result = enforceInstanceCapability({
      registry: r,
      token: 'itk_2',
      user: alice, // only records.read
      required: { api: 'records.write', scope: 'recordType:customer' },
    });
    expect(result.ok === false && result.denial.kind).toBe('permission_denied');
  });
});
