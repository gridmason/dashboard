import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The build-mode gate (SPEC §4, issue #11 acceptance): dev sideload ships in
 * **development builds only**. This test proves it by running the **real
 * production build** and asserting the dev-sideload path is absent from the
 * emitted bundle — the whole `./sideload` dev subtree is reached only under
 * `import.meta.env.DEV`, a static `false` in a production build, so Vite
 * dead-code-eliminates it (JS, and — because the styles are injected as an
 * inlined string from the dev-only provider — CSS too).
 *
 * It spawns the actual `vite build` CLI with `NODE_ENV=production` rather than
 * Vite's JS build API: under Vitest the JS API inherits `NODE_ENV=test` and
 * resolves the *development* React (and a non-production mode), which is not the
 * artifact the app ships. The CLI is the ground truth the production image is
 * built from.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Strings that exist only in the dev-sideload UI / styling — never in shared code.
const DEV_ONLY_SENTINELS = [
  'enable dev sideload', // owner-acknowledgement button (AddWidgetPicker)
  'No dev remotes admitted this session', // empty-state copy (AddWidgetPicker)
  'gridmason dev origin', // register-origin placeholder (AddWidgetPicker)
  'gm-sideload-badge', // canvas card badge class (sideload.css / CanvasHost)
  'gm-sl-scrim', // picker modal class (sideload.css)
];

let outDir: string;

function buildProduction(): string {
  outDir = mkdtempSync(join(tmpdir(), 'gm-dash-prodgate-'));
  execFileSync(
    process.execPath,
    [join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'],
    {
      cwd: repoRoot,
      // Force the real production build: `NODE_ENV=production` selects prod React
      // and makes `import.meta.env.DEV` a static `false` for the DCE the gate rests on.
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'ignore',
    },
  );
  return outDir;
}

/** Every emitted asset's text (JS + CSS + HTML), concatenated, for a substring scan. Maps excluded. */
function readAllAssets(dir: string): string {
  let combined = '';
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (/\.(js|css|html)$/.test(entry.name)) {
      combined += readFileSync(join(entry.parentPath, entry.name), 'utf8');
    }
  }
  return combined;
}

afterAll(() => {
  if (outDir !== undefined) rmSync(outDir, { recursive: true, force: true });
});

describe('production build gate', () => {
  it(
    'drops the dev-sideload path from the production bundle',
    () => {
      const assets = readAllAssets(buildProduction());
      for (const sentinel of DEV_ONLY_SENTINELS) {
        expect(assets, `production bundle must not contain "${sentinel}"`).not.toContain(sentinel);
      }
    },
    120_000,
  );
});
