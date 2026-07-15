import { describe, expect, it } from 'vitest';
import {
  CapabilityGate,
  eventsCapability,
  netCapability,
  readCapability,
  toCapability,
  writeCapability,
} from './capabilities';

describe('toCapability', () => {
  it('parses the string form into api + scope', () => {
    expect(toCapability('records.read:recordType:customer')).toEqual({
      api: 'records.read',
      scope: 'recordType:customer',
    });
    expect(toCapability('records.read')).toEqual({ api: 'records.read' });
  });

  it('passes the object form through, validated', () => {
    expect(toCapability({ api: 'net', scope: 'api.acme.com' })).toEqual({ api: 'net', scope: 'api.acme.com' });
  });

  it('throws on an unknown api', () => {
    expect(() => toCapability('bogus:x')).toThrow(/unknown-api/);
    expect(() => toCapability({ api: 'bogus' as never })).toThrow(/unknown-api/);
  });
});

describe('CapabilityGate — min(user, widget)', () => {
  it('permits a required capability only when both sides grant it', () => {
    const gate = new CapabilityGate(['records.read'], ['records.read:recordType:customer']);
    // widget declares only customer; user grants all reads → min = customer.
    expect(gate.allows(readCapability('customer'))).toBe(true);
    expect(gate.allows(readCapability('order'))).toBe(false); // widget never declared order
  });

  it('denies when the user side is narrower than the widget', () => {
    // widget declares all reads, user grants only customer → intersection = customer.
    const gate = new CapabilityGate(['records.read:recordType:customer'], ['records.read']);
    expect(gate.allows(readCapability('customer'))).toBe(true);
    expect(gate.allows(readCapability('order'))).toBe(false);
  });

  it('denies everything a widget declared nothing for', () => {
    const gate = new CapabilityGate(['records.read', 'net', 'events'], []);
    expect(gate.allows(readCapability('customer'))).toBe(false);
    expect(gate.allows(netCapability('api.acme.com'))).toBe(false);
    expect(gate.allows(eventsCapability('acme.sales'))).toBe(false);
  });

  it('scopes net and events by exact-prefix containment', () => {
    const gate = new CapabilityGate(['net', 'events'], ['net:api.acme.com', 'events:acme.sales']);
    expect(gate.allows(netCapability('api.acme.com'))).toBe(true);
    expect(gate.allows(netCapability('evil.example'))).toBe(false);
    expect(gate.allows(eventsCapability('acme.sales'))).toBe(true);
    expect(gate.allows(eventsCapability('secret.ops'))).toBe(false);
  });

  it('exposes the writeCapability shape', () => {
    const gate = new CapabilityGate(['records.write'], ['records.write:recordType:customer']);
    expect(gate.allows(writeCapability('customer'))).toBe(true);
    expect(gate.allows(writeCapability('order'))).toBe(false);
  });
});
