/**
 * Shared fixtures for the demo API test suites. Not a test file itself (no
 * `*.test` suffix) — it builds a config, a valid LayoutDoc, and boots the app
 * on an ephemeral port so each suite drives the service over real HTTP.
 */
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { AuthService } from '../auth/index';
import type { DemoConfig } from '../config/index';
import { LayoutStore, type LayoutDoc } from '../layout-store/index';

/** A two-user config matching the checked-in sample's shape. */
export function makeConfig(): DemoConfig {
  return {
    users: [
      { id: 'alice', username: 'alice', password: 'alice-dev-password', displayName: 'Alice Admin', roles: ['admin'] },
      { id: 'bob', username: 'bob', password: 'bob-dev-password', displayName: 'Bob Member', roles: ['member'] },
    ],
    gates: { 'widgets.chart': true, 'widgets.crasher': false },
  };
}

/** A valid current-schema (v1) LayoutDoc, with optional field overrides. */
export function makeLayoutDoc(overrides: Partial<LayoutDoc> = {}): LayoutDoc {
  return {
    schemaVersion: 1,
    page: 'dashboards.home',
    name: 'Home',
    default: true,
    hasTabs: false,
    grid: {
      items: [
        { widgetID: { source: 'local', tag: 'demo-clock' }, i: 'w1', x: 0, y: 0, w: 4, h: 2 },
      ],
    },
    tabs: [],
    ...overrides,
  };
}

export interface TestServer {
  readonly baseUrl: string;
  readonly store: LayoutStore;
  close(): Promise<void>;
}

/**
 * Boot the demo API on an ephemeral port with an in-memory store. Returns the
 * base URL, the store (for direct assertions), and a `close` teardown.
 */
export async function startTestServer(config: DemoConfig = makeConfig()): Promise<TestServer> {
  const store = new LayoutStore();
  const auth = new AuthService(config);
  const server = createApp({ config, store, auth });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    store,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** Log in and return the `Cookie` header value to authenticate later requests. */
export async function loginCookie(
  baseUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const setCookie = res.headers.getSetCookie().at(0);
  if (setCookie === undefined) throw new Error('login did not set a session cookie');
  return setCookie.split(';')[0]!; // "gm_session=<id>"
}
