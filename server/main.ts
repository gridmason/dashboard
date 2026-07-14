/**
 * Demo API entry point. Loads the config (failing loudly if it is malformed),
 * builds the layout store and stub-login service, and starts the HTTP server.
 *
 * Environment:
 *   PORT                        listen port (default 8787)
 *   GRIDMASON_DEMO_CONFIG       config file path (default: server/config/demo-config.json)
 *   GRIDMASON_LAYOUT_STORE      layout persistence file (default: server/.data/layouts.json)
 *   GRIDMASON_GOVERNANCE_STORE  org-publication file (default: server/.data/governance.json)
 */
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { AuthService } from './auth/index';
import { loadConfig } from './config/index';
import { LayoutStore } from './layout-store/index';
import { GovernanceStore } from './governance-store/index';

const PORT = Number(process.env.PORT ?? 8787);
const LAYOUT_STORE_PATH =
  process.env.GRIDMASON_LAYOUT_STORE ??
  fileURLToPath(new URL('./.data/layouts.json', import.meta.url));
const GOVERNANCE_STORE_PATH =
  process.env.GRIDMASON_GOVERNANCE_STORE ??
  fileURLToPath(new URL('./.data/governance.json', import.meta.url));

// loadConfig throws on a malformed config; leaving it uncaught aborts the boot.
const config = loadConfig();
const store = new LayoutStore({ filePath: LAYOUT_STORE_PATH });
const governance = new GovernanceStore({ filePath: GOVERNANCE_STORE_PATH });
const auth = new AuthService(config);

const server = createApp({ config, store, governance, auth });
server.listen(PORT, () => {
  process.stdout.write(`[demo-api] listening on http://localhost:${PORT}\n`);
});
