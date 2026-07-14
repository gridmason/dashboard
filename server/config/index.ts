/**
 * Demo API configuration (FR-6, SPEC §6 + §1): the single checked-in file that
 * declares the single-tenant users for the stub login (GW-D21) and the
 * config-file gate enablement flags.
 *
 * Loaded once at startup. A malformed file **fails loudly** — {@link loadConfig}
 * throws rather than booting a half-configured service, so a bad config is a
 * boot error, never a silent runtime surprise.
 *
 * Scope note: the gate revocation-feed merge is Phase B (FR-5). This loader
 * reads **config-file enablement only** — `gates` here are plain on/off flags.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A single-tenant user record for the stub login. `password` is stored in
 * plaintext on purpose: this is a stub for single-tenant pre-1.0, not real
 * authentication — identity is a host concern (GW-D21, SPEC §1).
 */
export interface DemoUser {
  /** Stable user id, used as the `user:<id>` owner in layout keys. */
  readonly id: string;
  /** Login name presented at the stub login. */
  readonly username: string;
  /** Plaintext stub password (see note above). */
  readonly password: string;
  /** Optional display name. */
  readonly displayName?: string;
  /** Role stubs for the permissions adapter (enforcement is Phase B, SPEC §6). */
  readonly roles?: readonly string[];
}

/**
 * Config-file gate enablement: a map of gate id → enabled flag. The registry
 * revocation feed is merged in on top of this in Phase B (FR-5); here the flags
 * stand alone.
 */
export type DemoGates = Readonly<Record<string, boolean>>;

/**
 * The host-configurable sideload posture (SPEC §4): `off` (registry-signed remotes
 * only — the default), `dev` (local dev-server remotes), or `acknowledged`
 * (persistent, owner-acknowledged remotes registered by URL). This is the
 * server-side, config-recorded authority for which sideload origins the deployment
 * permits — the client bakes its own posture separately (`src/sideload/policy.ts`);
 * in a single-origin deployment the operator sets both to the same value.
 */
export type SideloadMode = 'off' | 'dev' | 'acknowledged';

/** The default sideload posture when the config omits a `sideload` block: hard off. */
export const DEFAULT_SIDELOAD_MODE: SideloadMode = 'off';

/** The three valid postures, for validating the config value. */
const SIDELOAD_MODES: readonly SideloadMode[] = ['off', 'dev', 'acknowledged'];

/** The optional `sideload` config block. Absent means {@link DEFAULT_SIDELOAD_MODE}. */
export interface DemoSideloadConfig {
  readonly mode: SideloadMode;
}

/** The parsed, validated demo API config. */
export interface DemoConfig {
  readonly users: readonly DemoUser[];
  readonly gates: DemoGates;
  /** The sideload posture. Omitted in config = `off` — resolve with {@link sideloadMode}. */
  readonly sideload?: DemoSideloadConfig;
}

/**
 * The deployment's sideload posture, defaulting to {@link DEFAULT_SIDELOAD_MODE}
 * when the config omits a `sideload` block. `off` is the true default: a config
 * that says nothing about sideload permits no sideloaded origin.
 */
export function sideloadMode(config: DemoConfig): SideloadMode {
  return config.sideload?.mode ?? DEFAULT_SIDELOAD_MODE;
}

/** Env var that overrides {@link DEFAULT_CONFIG_PATH}. */
export const CONFIG_PATH_ENV = 'GRIDMASON_DEMO_CONFIG';

/** Default config path: the checked-in sample, resolved next to this module. */
export const DEFAULT_CONFIG_PATH = fileURLToPath(
  new URL('./demo-config.json', import.meta.url),
);

/** Resolve the active config path from the environment, or the default. */
export function resolveConfigPath(): string {
  const override = process.env[CONFIG_PATH_ENV];
  return override !== undefined && override !== '' ? override : DEFAULT_CONFIG_PATH;
}

/** Thrown when a config file is missing, unparseable, or structurally invalid. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(path: string, detail: string) {
    super(`Invalid demo config (${path}): ${detail}`);
  }
}

/**
 * Load and validate the demo config from `path` (default: the resolved config
 * path). Throws {@link ConfigError} on any problem — a missing file, invalid
 * JSON, or a shape that does not match {@link DemoConfig}.
 */
export function loadConfig(path: string = resolveConfigPath()): DemoConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new ConfigError(path, `cannot read file (${(cause as Error).message})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(path, `not valid JSON (${(cause as Error).message})`);
  }

  return validateConfig(parsed, path);
}

function validateConfig(value: unknown, path: string): DemoConfig {
  if (!isRecord(value)) {
    throw new ConfigError(path, 'top level must be an object');
  }

  const { users, gates } = value;

  if (!Array.isArray(users) || users.length === 0) {
    throw new ConfigError(path, '`users` must be a non-empty array');
  }
  const seenUsernames = new Set<string>();
  users.forEach((user, i) => {
    validateUser(user, i, path);
    const name = (user as DemoUser).username;
    if (seenUsernames.has(name)) {
      throw new ConfigError(path, `duplicate username "${name}"`);
    }
    seenUsernames.add(name);
  });

  if (!isRecord(gates)) {
    throw new ConfigError(path, '`gates` must be an object of id → boolean');
  }
  for (const [id, enabled] of Object.entries(gates)) {
    if (typeof enabled !== 'boolean') {
      throw new ConfigError(path, `gate "${id}" must be a boolean`);
    }
  }

  // `sideload` is optional — its absence is the `off` default (SPEC §4). When
  // present it must name a valid posture, so a typo fails loudly at boot rather
  // than resolving to something unexpectedly permissive.
  if ('sideload' in value && value.sideload !== undefined) {
    const { sideload } = value;
    if (!isRecord(sideload)) {
      throw new ConfigError(path, '`sideload` must be an object with a "mode"');
    }
    if (!SIDELOAD_MODES.includes(sideload.mode as SideloadMode)) {
      throw new ConfigError(
        path,
        `\`sideload.mode\` must be one of ${SIDELOAD_MODES.join(', ')}`,
      );
    }
  }

  // Validated: the parsed object matches DemoConfig by construction.
  return value as unknown as DemoConfig;
}

function validateUser(user: unknown, index: number, path: string): void {
  const at = `users[${index}]`;
  if (!isRecord(user)) {
    throw new ConfigError(path, `${at} must be an object`);
  }
  for (const field of ['id', 'username', 'password'] as const) {
    if (typeof user[field] !== 'string' || user[field] === '') {
      throw new ConfigError(path, `${at}.${field} must be a non-empty string`);
    }
  }
  if ('displayName' in user && typeof user.displayName !== 'string') {
    throw new ConfigError(path, `${at}.displayName must be a string`);
  }
  if ('roles' in user) {
    const { roles } = user;
    if (!Array.isArray(roles) || roles.some((r) => typeof r !== 'string')) {
      throw new ConfigError(path, `${at}.roles must be an array of strings`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
