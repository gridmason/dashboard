/**
 * api/config — config loading (FR-6 acceptance): the checked-in sample parses
 * into users + gates, and a malformed config fails loudly (throws) at load so a
 * bad config is a boot error, never a silent runtime surprise.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig, sideloadMode } from '../config/index';

describe('api/config', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(contents: string): string {
    dir = mkdtempSync(join(tmpdir(), 'gm-config-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, contents, 'utf8');
    return path;
  }

  it('parses the checked-in sample config into users and gates', () => {
    const config = loadConfig(DEFAULT_CONFIG_PATH);
    expect(config.users.map((u) => u.username)).toContain('alice');
    expect(config.gates['widgets.chart']).toBe(true);
    expect(config.gates['widgets.crasher']).toBe(false);
  });

  it('reads the shipped sideload posture as off — the config-visible default', () => {
    expect(sideloadMode(loadConfig(DEFAULT_CONFIG_PATH))).toBe('off');
  });

  it('defaults the sideload posture to off when the config omits a `sideload` block', () => {
    const path = writeConfig(
      JSON.stringify({ users: [{ id: 'a', username: 'a', password: 'p' }], gates: {} }),
    );
    const config = loadConfig(path);
    expect(config.sideload).toBeUndefined();
    expect(sideloadMode(config)).toBe('off');
  });

  it('accepts an explicit acknowledged posture', () => {
    const path = writeConfig(
      JSON.stringify({
        users: [{ id: 'a', username: 'a', password: 'p' }],
        gates: {},
        sideload: { mode: 'acknowledged' },
      }),
    );
    expect(sideloadMode(loadConfig(path))).toBe('acknowledged');
  });

  it('throws on an unknown sideload posture rather than resolving it permissively', () => {
    const path = writeConfig(
      JSON.stringify({
        users: [{ id: 'a', username: 'a', password: 'p' }],
        gates: {},
        sideload: { mode: 'on' },
      }),
    );
    expect(() => loadConfig(path)).toThrow(/sideload\.mode/);
  });

  it('throws on invalid JSON', () => {
    const path = writeConfig('{ not json');
    expect(() => loadConfig(path)).toThrow(ConfigError);
  });

  it('throws on a missing file', () => {
    expect(() => loadConfig(join(tmpdir(), 'does-not-exist-gm.json'))).toThrow(ConfigError);
  });

  it('throws when users is empty', () => {
    const path = writeConfig(JSON.stringify({ users: [], gates: {} }));
    expect(() => loadConfig(path)).toThrow(/users/);
  });

  it('throws when a user is missing a required field', () => {
    const path = writeConfig(JSON.stringify({ users: [{ id: 'a', username: 'a' }], gates: {} }));
    expect(() => loadConfig(path)).toThrow(/password/);
  });

  it('throws when a gate value is not a boolean', () => {
    const path = writeConfig(
      JSON.stringify({ users: [{ id: 'a', username: 'a', password: 'p' }], gates: { g: 'yes' } }),
    );
    expect(() => loadConfig(path)).toThrow(/boolean/);
  });
});
