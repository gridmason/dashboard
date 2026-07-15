import { describe, expect, it } from 'vitest';
import type { TypedTopic } from '@gridmason/sdk';
import { HostEventBus } from './event-bus';

const selected: TypedTopic<{ id: string }> = { ns: 'acme.sales', name: 'selected' };
const other: TypedTopic<{ id: string }> = { ns: 'acme.sales', name: 'other' };

describe('HostEventBus', () => {
  it('delivers a payload to subscribers of the exact topic', () => {
    const bus = new HostEventBus();
    const got: Array<{ id: string }> = [];
    bus.subscribe(selected, (p) => got.push(p));
    bus.emit(selected, { id: 's1' });
    expect(got).toEqual([{ id: 's1' }]);
  });

  it('routes by exact (ns, name) — a same-namespace different name reaches no one', () => {
    const bus = new HostEventBus();
    const got: Array<{ id: string }> = [];
    bus.subscribe(selected, (p) => got.push(p));
    bus.emit(other, { id: 'wrong' });
    expect(got).toEqual([]);
  });

  it('does not collide ns/name split boundaries', () => {
    const bus = new HostEventBus();
    const got: string[] = [];
    bus.subscribe({ ns: 'a', name: 'b.c' } as TypedTopic<string>, () => got.push('first'));
    bus.emit({ ns: 'a.b', name: 'c' } as TypedTopic<string>, 'x');
    expect(got).toEqual([]);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new HostEventBus();
    const got: Array<{ id: string }> = [];
    const off = bus.subscribe(selected, (p) => got.push(p));
    off();
    bus.emit(selected, { id: 's1' });
    expect(got).toEqual([]);
  });

  it('isolates a throwing handler so the others still receive the emission', () => {
    const bus = new HostEventBus();
    const got: string[] = [];
    bus.subscribe(selected, () => {
      throw new Error('boom');
    });
    bus.subscribe(selected, () => got.push('reached'));
    expect(() => bus.emit(selected, { id: 's1' })).not.toThrow();
    expect(got).toEqual(['reached']);
  });
});
