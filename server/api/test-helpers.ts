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
import { GovernanceStore } from '../governance-store/index';
import { SideloadRegistrationStore } from '../sideload-store/index';
import { InstanceTokenRegistry } from '../sdk-identity/index';
import {
  createScopedFetchService,
  StaticInstanceCapabilityStore,
  type UpstreamFetch,
} from '../scoped-fetch/index';

/** A two-user config matching the checked-in sample's shape. */
export function makeConfig(): DemoConfig {
  return {
    users: [
      {
        id: 'alice',
        username: 'alice',
        password: 'alice-dev-password',
        displayName: 'Alice Admin',
        roles: ['admin'],
        capabilities: ['records.read', 'records.write', 'net', 'events'],
      },
      {
        id: 'bob',
        username: 'bob',
        password: 'bob-dev-password',
        displayName: 'Bob Member',
        roles: ['member'],
        capabilities: ['records.read:recordType:customer', 'events:demo'],
      },
    ],
    gates: { 'widgets.chart': true, 'widgets.crasher': false, 'governance.publish': true },
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
  readonly governance: GovernanceStore;
  readonly sideload: SideloadRegistrationStore;
  /** The instance-token identity rail (SPEC §3, §6; FR-14), for direct assertions. */
  readonly identity: InstanceTokenRegistry;
  /** The scoped-fetch declared-capability resolver, for seeding a test instance's `net:<host>` grants. */
  readonly capabilities: StaticInstanceCapabilityStore;
  close(): Promise<void>;
}

/** Options for {@link startTestServer} — inject a stub upstream so a proxy test never hits the network. */
export interface TestServerOptions {
  /** The scoped-fetch proxy's outbound fetch. Defaults to the global `fetch`. */
  readonly upstream?: UpstreamFetch;
}

/**
 * Boot the demo API on an ephemeral port with in-memory stores. Returns the base
 * URL, the layout + governance + sideload stores, the instance-token registry, and
 * the scoped-fetch capability resolver (for direct assertions/seeding), plus a
 * `close` teardown.
 */
export async function startTestServer(
  config: DemoConfig = makeConfig(),
  options: TestServerOptions = {},
): Promise<TestServer> {
  const store = new LayoutStore();
  const governance = new GovernanceStore();
  const sideload = new SideloadRegistrationStore();
  const auth = new AuthService(config);
  const identity = new InstanceTokenRegistry();
  // The scoped-fetch tests seed net:<host> grants directly on this static store, so
  // it (not the identity rail) backs the proxy resolver under test; the identity
  // rail is exercised on its own routes. Production (server/main.ts) backs the
  // resolver with the identity rail — see its wiring.
  const capabilities = new StaticInstanceCapabilityStore();
  const scopedFetch = createScopedFetchService(capabilities, options.upstream);
  const server = createApp({ config, store, governance, sideload, auth, identity, scopedFetch });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    store,
    governance,
    sideload,
    identity,
    capabilities,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** Parse a JSON response body for assertions (the test suites drive real HTTP). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  return res.json();
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
