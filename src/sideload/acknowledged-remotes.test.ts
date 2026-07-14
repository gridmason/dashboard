import { describe, expect, it, vi } from 'vitest';
import { acknowledgedRemote, HashPinMismatchError } from './acknowledged-remotes';
import { sideloadSource } from './source';
import { sha256Pin } from './hash';
import type { AcknowledgedRemote } from './acknowledged-store';
import type { SideloadTelemetryEvent } from './telemetry';

const ORIGIN = 'https://widgets.internal.acme';
const ENTRY = 'https://widgets.internal.acme/entry.js';
const CONTENT = 'if(!customElements.get("acme-note"))customElements.define("acme-note",class extends HTMLElement{});';

async function makeRemote(overrides: Partial<AcknowledgedRemote> = {}): Promise<AcknowledgedRemote> {
  return {
    url: `${ORIGIN}/`,
    origin: ORIGIN,
    entryUrl: ENTRY,
    tag: 'acme-note',
    name: 'Field Notes',
    hash: await sha256Pin(new TextEncoder().encode(CONTENT)),
    acknowledgedBy: 'alice',
    at: '2026-07-14T00:00:00.000Z',
    widgetID: { source: sideloadSource(ORIGIN), tag: 'acme-note' },
    ...overrides,
  };
}

function fetchReturning(body: string): typeof fetch {
  return vi.fn(async () => new Response(new TextEncoder().encode(body), { status: 200 })) as unknown as typeof fetch;
}

describe('acknowledgedRemote', () => {
  it('imports the module only after the fetched content matches the pin', async () => {
    const remote = await makeRemote();
    const importModule = vi.fn(async () => ({ default: class {} }));
    const local = acknowledgedRemote(remote, { fetchImpl: fetchReturning(CONTENT), importModule });

    expect(local.tag).toBe('acme-note');
    expect(local.source).toBe(sideloadSource(ORIGIN));
    expect(local.specifier).toBe(`${sideloadSource(ORIGIN)}/acme-note`);

    await local.load();
    expect(importModule).toHaveBeenCalledWith(ENTRY);
  });

  it('refuses the load on a hash mismatch: no import, throws, emits telemetry', async () => {
    const remote = await makeRemote();
    const importModule = vi.fn(async () => ({}));
    const events: SideloadTelemetryEvent[] = [];
    const local = acknowledgedRemote(remote, {
      // Serve tampered bytes that do not match the pin.
      fetchImpl: fetchReturning(`${CONTENT}/* tampered */`),
      importModule,
      telemetry: (event) => events.push(event),
    });

    await expect(local.load()).rejects.toBeInstanceOf(HashPinMismatchError);
    expect(importModule).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'sideload.hash_mismatch', url: remote.url, expected: remote.hash });
  });

  it('throws (no import) when the entry cannot be fetched', async () => {
    const remote = await makeRemote();
    const importModule = vi.fn(async () => ({}));
    const local = acknowledgedRemote(remote, {
      fetchImpl: vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
      importModule,
    });
    await expect(local.load()).rejects.toThrow(/404/);
    expect(importModule).not.toHaveBeenCalled();
  });
});
