import { describe, expect, it, vi } from 'vitest';
import {
  DEV_MANIFEST_PATH,
  RAW_MANIFEST_PATH,
  WIDGET_DESCRIPTOR_PATH,
  fetchDevManifest,
  fetchWidgetDescriptor,
  parseDevManifest,
  parseWidgetDescriptor,
} from './manifest';

const ORIGIN = 'http://localhost:6070';

/** A `Response`-shaped stub whose `json()` resolves to `body`. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('parseDevManifest (real gridmason dev contract)', () => {
  it('accepts a valid live manifest and resolves a project-relative entry', () => {
    const parsed = parseDevManifest(
      { valid: true, violations: [], tag: 'acme-note', entry: 'src/entry.js' },
      ORIGIN,
      'acme-note',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.registration).toEqual({
        origin: ORIGIN,
        entryUrl: 'http://localhost:6070/src/entry.js',
        tag: 'acme-note',
        name: 'acme-note',
      });
    }
  });

  it('resolves a rooted entry path too', () => {
    const parsed = parseDevManifest({ valid: true, tag: 'acme-note', entry: '/dist/w.js' }, ORIGIN);
    expect(parsed.ok && parsed.registration.entryUrl).toBe('http://localhost:6070/dist/w.js');
  });

  it('defaults name to the tag when no display name is supplied', () => {
    const parsed = parseDevManifest({ valid: true, tag: 'acme-note', entry: 'src/entry.js' }, ORIGIN);
    expect(parsed.ok && parsed.registration.name).toBe('acme-note');
  });

  it('rejects a manifest the dev server flags invalid, surfacing its violations', () => {
    const parsed = parseDevManifest(
      { valid: false, violations: ['tag "note": missing publisher prefix'], tag: 'note', entry: 'src/entry.js' },
      ORIGIN,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/missing publisher prefix/);
  });

  it('rejects a non-object body', () => {
    expect(parseDevManifest('nope', ORIGIN).ok).toBe(false);
    expect(parseDevManifest(null, ORIGIN).ok).toBe(false);
  });

  it('rejects a missing or malformed tag', () => {
    expect(parseDevManifest({ valid: true, entry: 'src/e.js' }, ORIGIN).ok).toBe(false);
    expect(parseDevManifest({ valid: true, tag: 'note', entry: 'src/e.js' }, ORIGIN).ok).toBe(false);
    expect(parseDevManifest({ valid: true, tag: 'Acme-Note', entry: 'src/e.js' }, ORIGIN).ok).toBe(false);
  });

  it('rejects a missing entry, or one that points off-origin', () => {
    expect(parseDevManifest({ valid: true, tag: 'acme-note' }, ORIGIN).ok).toBe(false);
    expect(
      parseDevManifest({ valid: true, tag: 'acme-note', entry: 'https://evil.example/x.js' }, ORIGIN).ok,
    ).toBe(false);
  });
});

describe('fetchDevManifest', () => {
  it('reads /@dev/manifest for tag+entry and /manifest.json for the display name', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname;
      if (path === DEV_MANIFEST_PATH) {
        return jsonResponse({ valid: true, violations: [], tag: 'acme-note', entry: 'src/entry.js' });
      }
      if (path === RAW_MANIFEST_PATH) return jsonResponse({ name: 'Field Notes', tag: 'acme-note' });
      return jsonResponse(undefined, false, 404);
    }) as unknown as typeof fetch;

    const registration = await fetchDevManifest(ORIGIN, fetchImpl);
    expect(registration).toEqual({
      origin: ORIGIN,
      entryUrl: 'http://localhost:6070/src/entry.js',
      tag: 'acme-note',
      name: 'Field Notes',
    });
  });

  it('falls the name back to the tag when the raw manifest is unavailable', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname;
      if (path === DEV_MANIFEST_PATH) {
        return jsonResponse({ valid: true, violations: [], tag: 'acme-note', entry: 'src/entry.js' });
      }
      return jsonResponse(undefined, false, 404);
    }) as unknown as typeof fetch;

    const registration = await fetchDevManifest(ORIGIN, fetchImpl);
    expect(registration.name).toBe('acme-note');
  });

  it('rejects with a human message when the dev server is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(fetchDevManifest(ORIGIN, fetchImpl)).rejects.toThrow(/could not reach/);
  });

  it('rejects when /@dev/manifest responds non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, false, 404)) as unknown as typeof fetch;
    await expect(fetchDevManifest(ORIGIN, fetchImpl)).rejects.toThrow(/404/);
  });

  it('rejects when the live manifest is invalid', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname;
      if (path === DEV_MANIFEST_PATH) {
        return jsonResponse({ valid: false, violations: ['bad tag'], tag: null, entry: null });
      }
      return jsonResponse(undefined, false, 404);
    }) as unknown as typeof fetch;
    await expect(fetchDevManifest(ORIGIN, fetchImpl)).rejects.toThrow(/invalid/);
  });
});

describe('parseWidgetDescriptor (generic acknowledged-path contract)', () => {
  it('accepts a valid descriptor and resolves entry to an absolute same-origin URL', () => {
    const parsed = parseWidgetDescriptor(
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
    const parsed = parseWidgetDescriptor({ tag: 'acme-dev-note', entry: '/e.js' }, ORIGIN);
    expect(parsed.ok && parsed.registration.name).toBe('acme-dev-note');
  });

  it('rejects a non-object body', () => {
    expect(parseWidgetDescriptor('nope', ORIGIN).ok).toBe(false);
    expect(parseWidgetDescriptor(null, ORIGIN).ok).toBe(false);
  });

  it('rejects a missing or invalid custom-element tag', () => {
    expect(parseWidgetDescriptor({ name: 'x', entry: '/e.js' }, ORIGIN).ok).toBe(false);
    expect(parseWidgetDescriptor({ tag: 'note', entry: '/e.js' }, ORIGIN).ok).toBe(false);
    expect(parseWidgetDescriptor({ tag: 'Acme-Note', entry: '/e.js' }, ORIGIN).ok).toBe(false);
  });

  it('rejects an entry that points off the dev-server origin, or is missing', () => {
    expect(
      parseWidgetDescriptor({ tag: 'acme-dev-note', entry: 'https://evil.example/x.js' }, ORIGIN).ok,
    ).toBe(false);
    expect(parseWidgetDescriptor({ tag: 'acme-dev-note' }, ORIGIN).ok).toBe(false);
  });
});

describe('fetchWidgetDescriptor', () => {
  it('fetches the well-known descriptor path and returns a registration', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag: 'acme-dev-note', name: 'Field Notes', entry: '/entry.js' }),
    ) as unknown as typeof fetch;
    const registration = await fetchWidgetDescriptor(ORIGIN, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(`${ORIGIN}${WIDGET_DESCRIPTOR_PATH}`);
    expect(registration.tag).toBe('acme-dev-note');
    expect(registration.entryUrl).toBe('http://localhost:6070/entry.js');
  });

  it('rejects with a human message when the host is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(fetchWidgetDescriptor(ORIGIN, fetchImpl)).rejects.toThrow(/could not reach/);
  });

  it('rejects when the host responds non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, false, 404)) as unknown as typeof fetch;
    await expect(fetchWidgetDescriptor(ORIGIN, fetchImpl)).rejects.toThrow(/404/);
  });

  it('rejects when the served descriptor is invalid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag: 'bad name' })) as unknown as typeof fetch;
    await expect(fetchWidgetDescriptor(ORIGIN, fetchImpl)).rejects.toThrow();
  });
});
