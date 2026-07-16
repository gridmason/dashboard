/**
 * The registry catalog client (issue #85; contract gridmason/registry#63). Fetches
 * `GET /v1/widgets`, narrows the response defensively, and derives the endpoint
 * from the deployment's resolveEndpoint. No trust decisions here — that is the
 * picker's, against the admitted set (`../edit/widget-catalog`).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  RegistryCatalogError,
  fetchRegistryWidgets,
  widgetsEndpointFor,
  type RegistryWidgetList,
} from './registry-catalog';

const SAMPLE: RegistryWidgetList = {
  widgets: [
    {
      publisher: 'localdemo',
      tag: 'localdemo-clock',
      name: 'clock',
      description: 'A demo clock',
      latestVersion: '0.1.2',
      versions: ['0.1.2', '0.1.1'],
      capabilities: [{ api: 'records.read', scope: 'recordType:example' }],
    },
  ],
  nextCursor: null,
};

function fetchReturning(response: Response): { fetch: typeof globalThis.fetch; urls: string[] } {
  const urls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL) => {
    urls.push(String(input));
    return Promise.resolve(response);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('widgetsEndpointFor', () => {
  it('derives /v1/widgets on the registry origin from its resolveEndpoint', () => {
    expect(widgetsEndpointFor('http://localhost:8080/v1/resolve')).toBe('http://localhost:8080/v1/widgets');
    expect(widgetsEndpointFor('https://registry.gridmason.dev/v1/resolve')).toBe(
      'https://registry.gridmason.dev/v1/widgets',
    );
  });
});

describe('fetchRegistryWidgets', () => {
  const endpoint = 'http://localhost:8080/v1/widgets';

  it('fetches and returns the narrowed catalog', async () => {
    const { fetch } = fetchReturning(jsonResponse(SAMPLE));
    const list = await fetchRegistryWidgets(endpoint, {}, { fetch });
    expect(list.widgets).toHaveLength(1);
    expect(list.widgets[0]).toMatchObject({ publisher: 'localdemo', tag: 'localdemo-clock', latestVersion: '0.1.2' });
    expect(list.widgets[0].capabilities).toEqual([{ api: 'records.read', scope: 'recordType:example' }]);
    expect(list.nextCursor).toBeNull();
  });

  it('encodes the query/publisher/limit/cursor params', async () => {
    const { fetch, urls } = fetchReturning(jsonResponse(SAMPLE));
    await fetchRegistryWidgets(endpoint, { query: 'clock', publisher: 'localdemo', limit: 20, cursor: 'abc' }, { fetch });
    expect(urls[0]).toBe(`${endpoint}?query=clock&publisher=localdemo&limit=20&cursor=abc`);
  });

  it('omits empty params (bare endpoint when no query)', async () => {
    const { fetch, urls } = fetchReturning(jsonResponse(SAMPLE));
    await fetchRegistryWidgets(endpoint, { query: '' }, { fetch });
    expect(urls[0]).toBe(endpoint);
  });

  it('drops malformed entries rather than failing the whole page', async () => {
    const mixed = {
      widgets: [
        SAMPLE.widgets[0],
        { tag: 'no-publisher' }, // missing required fields → dropped
        null,
      ],
      nextCursor: 'next',
    };
    const { fetch } = fetchReturning(jsonResponse(mixed));
    const list = await fetchRegistryWidgets(endpoint, {}, { fetch });
    expect(list.widgets).toHaveLength(1);
    expect(list.nextCursor).toBe('next');
  });

  it('throws on a non-2xx status', async () => {
    const { fetch } = fetchReturning(new Response('nope', { status: 503 }));
    await expect(fetchRegistryWidgets(endpoint, {}, { fetch })).rejects.toBeInstanceOf(RegistryCatalogError);
  });

  it('throws when the body has no widgets array', async () => {
    const { fetch } = fetchReturning(jsonResponse({ items: [] }));
    await expect(fetchRegistryWidgets(endpoint, {}, { fetch })).rejects.toThrow(/no `widgets` array/);
  });

  it('throws when the endpoint is unreachable', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('network'))) as unknown as typeof globalThis.fetch;
    await expect(fetchRegistryWidgets(endpoint, {}, { fetch })).rejects.toBeInstanceOf(RegistryCatalogError);
  });
});
