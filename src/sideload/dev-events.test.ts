import { describe, expect, it, vi } from 'vitest';
import {
  DEV_EVENTS_PATH,
  DevReloadController,
  parseReloadFrame,
  reloadNeedsReimport,
  type EventSourceLike,
} from './dev-events';

/** A fake `EventSource` that records its url + close, and lets a test push frames. */
class FakeEventSource implements EventSourceLike {
  closed = false;
  readonly #listeners = new Map<string, Array<(event: { data: string }) => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    for (const listener of this.#listeners.get(type) ?? []) listener({ data });
  }
}

/** A factory that records every stream it opens, keyed by url. */
function recordingFactory(): { factory: (url: string) => FakeEventSource; opened: FakeEventSource[] } {
  const opened: FakeEventSource[] = [];
  return {
    opened,
    factory: (url) => {
      const stream = new FakeEventSource(url);
      opened.push(stream);
      return stream;
    },
  };
}

describe('parseReloadFrame', () => {
  it('parses each real reload category with its generation', () => {
    for (const category of ['source', 'manifest', 'fixtures', 'context'] as const) {
      expect(parseReloadFrame(JSON.stringify({ category, generation: 7 }))).toEqual({
        category,
        generation: 7,
      });
    }
  });

  it('rejects an unknown category, a non-numeric generation, and malformed input', () => {
    expect(parseReloadFrame(JSON.stringify({ category: 'nope', generation: 1 }))).toBeUndefined();
    expect(parseReloadFrame(JSON.stringify({ category: 'source', generation: 'x' }))).toBeUndefined();
    expect(parseReloadFrame(JSON.stringify({ category: 'source' }))).toBeUndefined();
    expect(parseReloadFrame('not json')).toBeUndefined();
    expect(parseReloadFrame('null')).toBeUndefined();
    expect(parseReloadFrame(JSON.stringify({ category: 'source', generation: Infinity }))).toBeUndefined();
  });
});

describe('reloadNeedsReimport', () => {
  it('is true only for the categories that bump the generation (fresh module graph)', () => {
    expect(reloadNeedsReimport('source')).toBe(true);
    expect(reloadNeedsReimport('manifest')).toBe(true);
    expect(reloadNeedsReimport('fixtures')).toBe(false);
    expect(reloadNeedsReimport('context')).toBe(false);
  });
});

describe('DevReloadController', () => {
  it('opens one stream per admitted origin, at the dev-events path', () => {
    const { factory, opened } = recordingFactory();
    const controller = new DevReloadController({ onReload: vi.fn(), eventSourceFactory: factory });

    controller.setOrigins(['http://localhost:6070', 'http://localhost:6071']);

    expect(opened.map((s) => s.url)).toEqual([
      `http://localhost:6070${DEV_EVENTS_PATH}`,
      `http://localhost:6071${DEV_EVENTS_PATH}`,
    ]);
    expect(controller.origins()).toEqual(['http://localhost:6070', 'http://localhost:6071']);
  });

  it('forwards a parsed reload frame to onReload, tagged with its origin', () => {
    const onReload = vi.fn();
    const { factory, opened } = recordingFactory();
    const controller = new DevReloadController({ onReload, eventSourceFactory: factory });
    controller.setOrigins(['http://localhost:6070']);

    opened[0]!.emit('reload', JSON.stringify({ category: 'source', generation: 3 }));

    expect(onReload).toHaveBeenCalledExactlyOnceWith('http://localhost:6070', {
      category: 'source',
      generation: 3,
    });
  });

  it('ignores a malformed reload frame rather than calling onReload', () => {
    const onReload = vi.fn();
    const { factory, opened } = recordingFactory();
    const controller = new DevReloadController({ onReload, eventSourceFactory: factory });
    controller.setOrigins(['http://localhost:6070']);

    opened[0]!.emit('reload', 'not json');

    expect(onReload).not.toHaveBeenCalled();
  });

  it('leaves an already-connected origin untouched and closes a removed one', () => {
    const { factory, opened } = recordingFactory();
    const controller = new DevReloadController({ onReload: vi.fn(), eventSourceFactory: factory });
    controller.setOrigins(['http://localhost:6070', 'http://localhost:6071']);

    // Drop 6071, keep 6070: no reconnect for 6070, and 6071's stream is closed.
    controller.setOrigins(['http://localhost:6070']);

    expect(opened).toHaveLength(2); // no third stream opened for the surviving origin
    expect(opened[0]!.closed).toBe(false); // 6070 kept
    expect(opened[1]!.closed).toBe(true); // 6071 closed
    expect(controller.origins()).toEqual(['http://localhost:6070']);
  });

  it('close() tears every stream down', () => {
    const { factory, opened } = recordingFactory();
    const controller = new DevReloadController({ onReload: vi.fn(), eventSourceFactory: factory });
    controller.setOrigins(['http://localhost:6070', 'http://localhost:6071']);

    controller.close();

    expect(opened.every((s) => s.closed)).toBe(true);
    expect(controller.origins()).toEqual([]);
  });

  it('reports stream errors best-effort without dropping the connection', () => {
    const onError = vi.fn();
    const { factory, opened } = recordingFactory();
    const controller = new DevReloadController({
      onReload: vi.fn(),
      onError,
      eventSourceFactory: factory,
    });
    controller.setOrigins(['http://localhost:6070']);

    opened[0]!.emit('error', 'boom');

    expect(onError).toHaveBeenCalledWith('http://localhost:6070', expect.anything());
    expect(opened[0]!.closed).toBe(false);
  });

  it('is inert when no EventSource is available (non-browser build)', () => {
    vi.stubGlobal('EventSource', undefined);
    try {
      // No factory injected and no global EventSource → opening is a no-op, never throws.
      const controller = new DevReloadController({ onReload: vi.fn() });
      expect(() => controller.setOrigins(['http://localhost:6070'])).not.toThrow();
      expect(controller.origins()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
