# Content-Security-Policy (operator guide)

The dashboard ships an enforced production **Content-Security-Policy** (SPEC §3,
FR-13). The policy is defined once, in code, and every delivery channel renders
that same policy — nothing is hand-maintained per channel.

- **Source of truth:** `src/security/production-csp.ts` (`buildProductionCspHeader`).
- **Enforced in production:** `docker/nginx.conf` serves the header on the app
  document. The checked-in string is pinned to the builder's default output by
  `src/security/nginx-csp.test.ts`, so it cannot drift.
- **Validated report-only:** `vite preview` serves the same policy as
  `Content-Security-Policy-Report-Only`; `e2e/csp.spec.ts` drives the real built
  bundle across every demo flow and asserts **zero** violations.

## The policy

```
default-src 'self';
script-src 'self' <registry-cdn origins> <acknowledged-sideload origins>;
connect-src 'self' <registry-cdn origins>;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
worker-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
frame-src 'none';
form-action 'self'
```

- **`script-src`** is the shell (`'self'`) plus any trusted registry-CDN origins a
  deployment federates, plus any acknowledged-sideload origins (see below). It
  carries **no** `'unsafe-inline'` / `'unsafe-eval'` — the production bundle ships
  neither. (Dev's permissive relaxation lives in `vite/dev-sideload-csp.ts` and
  never reaches production.)
- **`connect-src`** is the host API (`'self'` — the SPA and its API are same-origin)
  plus the registry origins the verifying Service Worker reads signed release
  documents and inclusion proofs from. It carries **no third-party host**: a
  `net:<host>` widget cannot open a browser connection to its host. That call is
  proxied through the same-origin **scoped-fetch endpoint** (`POST /api/scoped-fetch`,
  `server/scoped-fetch`), which re-checks the widget's declared host allowlist
  server-side before fetching. Because no widget capability can widen `connect-src`,
  the policy never has to change for a widget.
- **No iframes** (SPEC §3): the app is neither embedded (`frame-ancestors 'none'`)
  nor embeds anything (`frame-src 'none'`).

## Per-mode sideload (SPEC §4)

Sideload alters the CSP only as specified, and every added origin is visible in the
deployment's config:

| Mode | `script-src` effect |
|---|---|
| `off` (default) | none — the production CSP is never relaxed |
| `dev` | the localhost dev-server origin, **dev build only**, only while the dev gate is on (`vite/dev-sideload-csp.ts`) — never in a production build |
| `acknowledged` | each acknowledged origin, added by explicit owner action and recorded in config (`server/config` `sideload.mode` + the registrations `GET /api/sideload` reports as `scriptSrc`) |

The server computes the acknowledged `script-src` additions with
`acknowledgedScriptSrc(mode, registrations)` — **empty** unless the posture is
explicitly `acknowledged`. Pass that list as `sideloadScriptSrc` to
`buildProductionCspHeader` when generating a deployment's header, and it appears in
`script-src` (never `connect-src`). See [docs/sideload.md](./sideload.md).

## Federating a registry

A deployment that resolves remotes from a registry passes its trusted CDN origin(s)
to the builder (`registryOrigins`) — they join `script-src` (verified remote modules
execute from there) and `connect-src` (the SW reads signed content from there). A
resolution API or revocation feed on a *different* origin than the CDN goes in
`connectOrigins` (`connect-src` only). For the preview server, set
`GRIDMASON_REGISTRY_ORIGINS` (comma-separated).

## Static hosting without header control

`docker/nginx.conf` is the reference; any host that can set response headers should
serve the same `Content-Security-Policy` value. A purely static host that cannot set
headers may instead render most of the policy as a document `<meta>` tag:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; …" />
```

Caveat: a `<meta>` CSP **cannot** express `frame-ancestors` (browsers ignore it in
meta) and cannot be report-only. Pair it with an `X-Frame-Options: DENY` header (or
a host that supports the CSP header) to keep the no-framing guarantee.

The **static-demo build** (`npm run build:static-demo`, for header-less hosts like
GitHub Pages) does exactly this automatically: it injects the enforced policy as the
`<meta>` tag above — built from the same `buildProductionCspHeader` source of truth,
minus `frame-ancestors` — via `vite/static-demo.ts`. See the README's
[Static demo build](../README.md#static-demo-build) section.
