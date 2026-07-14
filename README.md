# Gridmason Dashboard

The permanent, **product-neutral** dashboard app over [`@gridmason/core`](https://www.npmjs.com/package/@gridmason/core) and a Gridmason Registry. It is three things at once:

- the **end-to-end proof** that the whole Gridmason platform works,
- the **OSS showcase** and the **widget-author dev target**, and
- a **genuinely deployable** dashboard — a small team can run it as their own, not just demo it.

Built in React + TypeScript with Vite. Single-tenant pre-1.0. Engineering spec: [`docs/SPEC.md`](docs/SPEC.md); build plan: [`docs/specs/dashboard-v0/spec.md`](docs/specs/dashboard-v0/spec.md).

> **Status: bootstrap (D-E0).** This is the app skeleton. Every route already mounts core's page canvas through the no-special-case-pages invariant (below), but the canvas renders **empty** — `@gridmason/core@0.1.0` ships `<gm-page-canvas>` as an explicit placeholder, and demo page types + widgets arrive in later epics (D-E1+). See [issue #2](https://github.com/gridmason/dashboard/issues/2).

## The one invariant

Gridmason has **no special-case page components**. A route's only job is to resolve a `{ pageType, entityId? }` and hand it to a single generic canvas host ([`src/canvas/CanvasHost.tsx`](src/canvas/CanvasHost.tsx)), which mounts core's `<gm-page-canvas>`. A fully locked page, a free-canvas dashboard, and a typed record-detail page are all the same component with different data. New page types and widgets are added as **data and registrations**, never as new page components.

Route model ([`src/routes.ts`](src/routes.ts)):

| Path | Resolves to |
|---|---|
| `/` | `{ pageType: "dashboards.home" }` |
| `/p/:pageType` | `{ pageType }` |
| `/p/:pageType/:entityId` | `{ pageType, entityId }` |

## Getting started

Requires Node `>= 22.12`.

```bash
npm install
npm run dev            # Vite dev server at http://localhost:5173
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check (`tsc --noEmit`) then build the static bundle to `dist/`. |
| `npm run preview` | Serve the built `dist/` bundle (port 4173). |
| `npm run typecheck` | Type-check only. |
| `npm run e2e` | Run the Playwright suite. Run `npm run build` first — the suite serves the built bundle. |
| `npm run e2e:install` | Install the Playwright browser (Chromium) with OS deps. |
| `npm run lighthouse` | Run the Lighthouse CI perf pass over the built bundle. |
| `npm test` | Run unit tests (Vitest) — app source and the demo API. |
| `npm run api:dev` | Run the demo API with reload (`tsx watch`), default port 8787. |
| `npm run api:start` | Run the demo API once (`tsx`). |
| `npm run api:typecheck` | Type-check the demo API (`server/`, Node target). |
| `npm run api:test` | Run the demo API test suites (Vitest, boots the service). |

## Releases

The dashboard **publishes nothing to npm** (FR-17). It releases as two artifacts, both produced by CI:

- a **deployable app image** (`Dockerfile` — the static bundle behind nginx), and
- a **static bundle** (`dist/`) for any static host.

## Demo API (reference adapters)

`server/` holds the **demo API service** — the backend the dashboard's reference persistence adapter talks to (FR-5, FR-6; [`docs/SPEC.md`](docs/SPEC.md) §6). It is a small `node:http` service (no web framework) that provides:

- a **layout KV store** keyed `(scope|user, pageType, entityId?) → LayoutDoc`, in-memory with optional file backing;
- **config loading** from [`server/config/demo-config.json`](server/config/demo-config.json) — the single-tenant `users` and config-file `gates` (enablement flags); a malformed config fails loudly at startup;
- a **stub login** (config-file users, no real authn/SSO — GW-D21) that gates every route under `/api/layouts` and `/api/auth/me`.

Run it with `npm run api:dev`. Override the config path with `GRIDMASON_DEMO_CONFIG`, the persistence file with `GRIDMASON_LAYOUT_STORE`, and the port with `PORT`. The React app's adapters that consume this API are wired in D-E1; here the backend contracts are proven in isolation by the `server/api/*.test.ts` suites. The reference host-SDK enforcement (remote-identity + `min(user, widget-capability)`) and the gate revocation-feed merge are Phase B.

## Theming

The default Gridmason theme is a small set of **CSS custom properties** ([`src/theme/tokens.css`](src/theme/tokens.css)) — the entire theming surface. A host re-themes the dashboard by overriding those properties; nothing else. Light is the default; dark follows the OS preference and can be forced with `data-theme="light" | "dark"` on `:root`.

## Contributing & license

Licensed under **AGPL-3.0-or-later** ([`LICENSE`](LICENSE)). Contributions require agreeing to the Contributor License Agreement — see [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CLA.md`](CLA.md).
