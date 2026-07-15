# Gridmason Dashboard

The permanent, **product-neutral** dashboard app over [`@gridmason/core`](https://www.npmjs.com/package/@gridmason/core) and a Gridmason Registry. It is three things at once:

- the **end-to-end proof** that the whole Gridmason platform works,
- the **OSS showcase** and the **widget-author dev target**, and
- a **genuinely deployable** dashboard — a small team can run it as their own, not just demo it.

Built in React + TypeScript with Vite. Single-tenant pre-1.0. Engineering spec: [`docs/SPEC.md`](docs/SPEC.md); build plan: [`docs/specs/dashboard-v0/spec.md`](docs/specs/dashboard-v0/spec.md).

> **Status: static boot (D-E1).** Every route mounts core's `<gm-page-canvas>` (the `@gridmason/*` versions pinned in [`package.json`](package.json)) through the no-special-case-pages invariant (below) and renders one of four demo page types from a **local import map** — the Phase-A stand-in for federated boot (no registry). Page types are data ([`src/pages/page-types.ts`](src/pages/page-types.ts)); widgets are a Phase-A placeholder ([`src/widgets/placeholder.ts`](src/widgets/placeholder.ts)) that the first-party demo widgets replace in a later epic. See [issue #5](https://github.com/gridmason/dashboard/issues/5).

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

## Deploy

The dashboard is a static single-page app; deploying it means serving the built
bundle with an SPA fallback (unknown paths resolve to `index.html`) and, ideally,
the production security headers.

### Docker (bundle behind nginx)

The `Dockerfile` builds the bundle and serves it with nginx; the container
listens on port **80** (`docker/nginx.conf`), which also emits the enforced
production Content-Security-Policy (`docs/csp.md`).

```bash
docker build -t gridmason-dashboard .
docker run -p 8080:80 gridmason-dashboard
# → http://localhost:8080
```

### Static host (raw `dist/`)

For any static host or CDN, build the bundle and serve `dist/`:

```bash
npm run build      # → dist/
```

Two requirements the host must meet:

- **SPA fallback.** Client-routed paths (`/p/:pageType/:entityId`) must fall back
  to `index.html`, exactly as `docker/nginx.conf`'s `try_files … /index.html`
  does. Configure your host's equivalent rewrite.
- **Security headers.** `docker/nginx.conf` is the reference for the
  `Content-Security-Policy` (and `frame-ancestors`) the app expects. A host that
  can set response headers should serve the same policy; one that cannot can
  render most of it as a `<meta>` tag, with the caveats in
  [`docs/csp.md`](docs/csp.md#static-hosting-without-header-control).

The demo API (`server/`) is a separate optional process, not part of the static
bundle — run it alongside the app if you want the reference persistence backend
(see [Demo API](#demo-api-reference-adapters) below for its env knobs).

### Connecting a registry

Federated boot — resolving and verifying widget remotes from a live Gridmason
Registry — is **Phase B** (SPEC milestone M2, epic D-E3) and is not wired in this
Phase-A build; the dashboard currently renders demo page types from a local
import map, not a registry. See the build plan
([`docs/specs/dashboard-v0/spec.md`](docs/specs/dashboard-v0/spec.md)) for status.

What a deployment can configure **today** is the CSP surface for a registry it
intends to federate. The production policy is self-only by default; a deployment
that will resolve remotes from a registry appends that registry's trusted CDN
origin(s) to `script-src` and `connect-src` (the verifying Service Worker reads
signed content from there). For the `vite preview` report-only validation server,
set `GRIDMASON_REGISTRY_ORIGINS` (comma- or space-separated) and those origins
are folded into the reported policy; for the production nginx image, add the same
origins to the header in `docker/nginx.conf`. The full mechanism, including
acknowledged-sideload origins and connect-only origins, is documented in
[`docs/csp.md`](docs/csp.md#federating-a-registry).

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
