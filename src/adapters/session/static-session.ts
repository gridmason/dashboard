/**
 * The **static demo** session bootstrap — the serverless counterpart of
 * {@link ./session-client} (docs/SPEC.md §1, GW-D21). The static build
 * (`npm run build:static-demo`) has no demo API to sign in against, so instead of
 * an HTTP stub login it signs in as a **fixed demo user baked into the bundle**
 * from `src/static-demo/demo-config.json`.
 *
 * Identity is a host concern pre-1.0 (Gridmason ships a stub, not real
 * authentication). Here the "session" is a static fact: the configured
 * `currentUser`, resolved from the baked user list, with its roles — enough to
 * give layouts a concrete `user:<id>` scope and to drive the publisher-role gate
 * (`admin`). No network call, no cookie, no secret: the config is public demo
 * data. The same seam a real host swaps for its own identity
 * ({@link ./session-client}) is swapped here for the static one by
 * `src/adapters/backend.ts`.
 */
import demoConfig from '../../static-demo/demo-config.json';
import type { SessionUser } from './session-client';

/** The baked static-demo config: the fixed demo users, the current one, and the demo gate posture. */
export interface StaticDemoConfig {
  /** The `id` of the user the static demo signs in as; must be one of {@link users}. */
  readonly currentUser: string;
  /** The demo users the build ships with (id, username, displayName, roles). */
  readonly users: readonly SessionUser[];
  /**
   * The demo's declared gate posture, baked as data. The server build enforces
   * gates in the demo API; the static build carries them as documentation of the
   * demo's intended posture (client-side picker gating is Phase B).
   */
  readonly gates: Readonly<Record<string, boolean>>;
}

/** The parsed, typed baked config. */
const config = demoConfig as StaticDemoConfig;

/** The baked static-demo config (users, current user, gate posture). */
export function staticDemoConfig(): StaticDemoConfig {
  return config;
}

/** The fixed demo user the static build signs in as. Throws if the config is inconsistent. */
export function staticDemoUser(): SessionUser {
  const user = config.users.find((candidate) => candidate.id === config.currentUser);
  if (user === undefined) {
    throw new Error(
      `static demo config: currentUser "${config.currentUser}" is not one of the baked users`,
    );
  }
  return user;
}

/**
 * Resolve the static demo session — the baked {@link staticDemoUser}. Async to
 * match {@link ./session-client}'s `ensureSession` so the composition seam
 * (`src/adapters/backend.ts`) can swap one for the other transparently.
 */
export async function ensureStaticSession(): Promise<SessionUser> {
  return staticDemoUser();
}
