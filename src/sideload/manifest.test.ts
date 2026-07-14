import { describe, expect, it, vi } from 'vitest';
import {
  DEV_WIDGET_MANIFEST_PATH,
  fetchDevWidgetManifest,
  parseDevWidgetManifest,
} from './manifest';

const ORIGIN = 'http://localhost:6070';

describe('parseDevWidgetManifest', () => {
  it('accepts a valid descriptor and resolves entry to an absolute same-origin URL', () => {
    const parsed = parseDevWidgetManifest(
      { tag: 'acme-dev-note', name: 'Field Notes', entry: '/entry.js' },
      ORIGIN,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.registration).toEqual({
        origin: ORIGIN,
        entryUrl: 'http://localhost:6070/entry.js',
        tag: 'acme-dev-note',
        name: 'Field Notes',
      });
    }
  });

  it('defaults name to the tag when absent', () => {
    const parsed = parseDevWidgetManifest({ tag: 'acme-dev-note', entry: '/e.js' }, ORIGIN);
    expect(parsed.ok && parsed.registration.name).toBe('acme-dev-note');
  });

  it('rejects a non-object body', () => {
    expect(parseDevWidgetManifest('nope', ORIGIN).ok).toBe(false);
    expect(parseDevWidgetManifest(null, ORIGIN).ok).toBe(false);
  });

  it('rejects a missing or invalid custom-element tag', () => {
    expect(parseDevWidgetManifest({ name: 'x', entry: '/e.js' }, ORIGIN).ok).toBe(false);
    // No hyphen → not a valid custom-element name.
    expect(parseDevWidgetManifest({ tag: 'note', entry: '/e.js' }, ORIGIN).ok).toBe(false);
    // Uppercase → invalid.
    expect(parseDevWidgetManifest({ tag: 'Acme-Note', entry: '/e.js' }, ORIGIN).ok).toBe(false);
  });

  it('rejects an entry that points off the dev-server origin', () => {
    const parsed = parseDevWidgetManifest(
      { tag: 'acme-dev-note', entry: 'https://evil.example/x.js' },
      ORIGIN,
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects a missing entry', () => {
    expect(parseDevWidgetManifest({ tag: 'acme-dev-note' }, ORIGIN).ok).toBe(false);
  });
});

describe('fetchDevWidgetManifest', () => {
  function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
      ok,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  it('fetches the well-known manifest path and returns a registration', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag: 'acme-dev-note', name: 'Field Notes', entry: '/entry.js' }),
    );
    const registration = await fetchDevWidgetManifest(ORIGIN, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(`${ORIGIN}${DEV_WIDGET_MANIFEST_PATH}`);
    expect(registration.tag).toBe('acme-dev-note');
    expect(registration.entryUrl).toBe('http://localhost:6070/entry.js');
  });

  it('rejects with a human message when the dev server is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchDevWidgetManifest(ORIGIN, fetchImpl)).rejects.toThrow(/could not reach/);
  });

  it('rejects when the dev server responds non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, false, 404));
    await expect(fetchDevWidgetManifest(ORIGIN, fetchImpl)).rejects.toThrow(/404/);
  });

  it('rejects when the served manifest is invalid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag: 'bad name' }));
    await expect(fetchDevWidgetManifest(ORIGIN, fetchImpl)).rejects.toThrow();
  });
});
