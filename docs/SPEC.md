# SPEC — Gridmason Dashboard

**Repo:** `gridmason/dashboard` · **Deliverable:** deployable app · **License:** AGPL-3.0 (CLA required) · **Status:** draft v0.2 · **Project:** [Gridmason](https://github.com/gridmason/.github) · **Role:** permanent app (GW-D3)

The product-neutral dashboard app over `@gridmason/core` + a Gridmason Registry. **Permanent** (GW-D3): a long-lived repo with its own release cadence that (a) proves the whole platform end to end, (b) is the OSS showcase + widget-author dev target, and (c) is genuinely deployable — a team can run it as its dashboard, not just demo it.

**Built in React** (GW-D16) — the largest widget-author audience, and the reference target for the React-first `@gridmason/sdk` helper set (sdk §4). The choice is a host-app decision only: `core` stays framework-agnostic (custom-element widgets from any framework mount unchanged), and nothing about React leaks into the widget ABI.

## 1. Scope

**In:** boot pipeline (gate snapshot → import map → lazy remotes), custom-element mounting via core's `PageCanvas`, reference adapter implementations (persistence, gates, permissions), reference host-SDK implementation, CSP + token hardening, the sideload policy modes, demo page types + first-party demo widgets, the widget-author dev loop.

**Out:** any product features (org trees, RBAC models — simple stand-ins behind the adapters), registry internals, multi-user authn/SSO (**single-tenant pre-1.0**: config-file users + stub login, GW-D21 — identity is a host concern).

## 2. Boot pipeline

```
boot → gate snapshot (which widgets/plugins enabled for this deployment)
  → import map assembled (local remotes + enabled registry remotes
                          + acknowledged sideload origins per §4 — nothing else)
  → lazy: route/slot activation dynamically imports the widget's entry module
  → element registered → mounted by PageCanvas with context + saved props + SDK handle
```

- Shared deps are versioned imports via the **import map** (GW-D22): the shell declares what it offers; the registry resolution API checks each widget's `sharedScope` ranges at resolve time and emits import-map `scopes` entries when widgets need different majors — **never globals**, no Module-Federation runtime. `sharedScope` optional; omitted = fully self-contained remote.
- Before any remote executes, the shell verifies **publisher signature + registry countersignature + content hash + transparency-log inclusion**, using the verification lib in `@gridmason/protocol`.
- **Verification mechanism** (plain `import()` has no hash hook): the shell-owned **Service Worker intercepts every remote fetch** and verifies **by exact URL + content hash against the specific registry's signed release document that listed it** — trust is bound per URL, not per origin, so two registries sharing a CDN host (common with object stores) cannot cross-contaminate. The SW buffers each artifact fully, verifies the hash, and only then serves it — hash verification cannot stream-then-revoke, and remote artifacts are small enough that buffering is acceptable (mismatch = network-error to the importer → error-boundary fallback + telemetry). A fetched URL no release document claims is refused outright. Import-map `integrity` metadata is attached additionally where the browser supports it. Remotes are **never** fetched-then-`eval`ed.
- **The SW lifecycle is part of the trust chain.** The shell assembles the import map **only after the Service Worker controls the page** — first visit: register → await control (reloading once if required) → then resolve remotes. If the SW is unavailable (unsupported browser mode, disabled storage), the shell fails closed to shell-bundled content only: no registry or sideloaded remote loads without the verifying SW in front of it.
- **Gate = kill switch**: a disabled widget's remote never enters the import map. The gate adapter consumes each trusted registry's signed revocation & kill feed and merges them with local enablement (ownership contract: registry spec §6), tracking freshness **per registry** — a stale registry fails closed for *its* remotes only.

## 3. Security model

- **CSP:** `script-src` = shell + trusted registry-CDN origins; `connect-src` = API origin **+ registry-CDN origins** (read-only, signed content: release documents + inclusion proofs sit on the runtime hot path; the Service Worker is the only intended consumer). **All widget network I/O flows through the SDK**, which enforces declared capabilities per call (`min(user permissions, widget capabilities)`).
- **No iframes:** widgets are same-document custom elements; isolation = reviewed signed code + capability-scoped SDK + CSP.
- **Token hardening:** the session token is held in a shell-owned Service Worker, never readable by page/widget JS; the SW attaches auth to every outbound API call. **Per-remote identity rides a separate rail:** at mount the shell mints an unforgeable per-instance token, held inside the SDK handle's closure and attached by the SDK transport to every call; the API maps it to `(instanceId, widgetId, declared capabilities)` and rejects capability-scoped calls without a valid one. A widget that bypasses the SDK reaches the API with session auth but *no* instance token — it is an anonymous page script, and every capability-gated route denies it. Honest framing: same-document JS offers no hard isolation boundary, so the binding is enforcement plumbing plus an audit trail, not a sandbox — the actual boundary remains reviewed signed code + capability-scoped SDK + CSP (the no-iframes principle).
- **Scoped fetch is proxied.** `net:<host>` capability calls go through the host API's scoped-fetch endpoint (which re-checks the widget's declared host allowlist server-side) rather than connecting to third-party origins from the browser — `connect-src` stays minimal and no widget capability ever mutates the CSP.
- **Per-widget error boundary** (from core): failed remote → fallback card with widget name + retry; the shell never blocks on widget code. Widget-attributed error/latency telemetry; a widget exceeding budgets is auto-degraded to fallback and flagged.

## 4. Sideload (GW-D7)

The production path is registry-signed remotes only. Sideload is a **host-configurable policy** — the platform doesn't dictate a host's risk posture, it makes every posture explicit. Three modes:

| Mode | What loads | CSP handling |
|---|---|---|
| `off` (default) | registry-signed remotes only | production CSP, never relaxed |
| `dev` | + local dev-server remotes, **per-session allowlist**, nothing persisted | dev build adds the localhost origin to `script-src` **only while the dev gate is on** |
| `acknowledged` | + persistent owner-acknowledged sideloaded remotes, registered **by URL** (never inline/`base64` code) | each acknowledged origin is individually added to `script-src` by explicit owner action, recorded in config |

Common to `dev` and `acknowledged`: unlocked only by an **owner acknowledgement** (explicit, disclaimed — the deploying owner accepts the risk of unreviewed code); every sideloaded widget is **marked distinctly in the UI** (badge on card + picker entry); sideloaded remotes bypass registry review but still ride the Service-Worker fetch path (hash pinned at registration time for `acknowledged`). The **production CSP is never silently relaxed** — every sideload origin present in `script-src` is visible in the deployment's config.

`dev` mode is the widget-author loop: `gridmason dev` serves the remote locally; the dashboard hot-loads it; `gridmason lint` runs the same automated checks a registry review runs. The dashboard ships with `dev` enabled in development builds only.

## 5. Demo content (ships with the app)

- Page types: `dashboards.home` (free canvas), `demo.record-detail` (typed `record-ref` context + locked header slot), `demo.locked` (fully locked page), `demo.full-canvas` (one maximized locked widget — proves the no-special-case rule).
- First-party demo widgets exercising the whole ABI: clock/markdown (static), record-summary (context consumer), settings-heavy chart (JSON-schema props), a deliberately-crashing widget (error-boundary demo).
- Governance demo: publish an "organization layout" with locks, then override as a user, then reset — the 3-level resolution made visible.

## 6. Reference adapters + reference SDK

| Adapter | Dashboard implementation |
|---|---|
| persistence | API-backed layout store (simple KV, keyed `(scope|user, pageType, entityId?)`) |
| gates | config-file enablement merged with the registry revocation feed |
| permissions | simple role stub |
| telemetry | console/OTLP exporter |

Adapter implementations are the reference documentation for anyone embedding the engine. The demo API is deliberately more than a stub in one place: it **implements the remote-identity check and `min(user, widget-capability)` enforcement as reference code** (the reference implementation of the `@gridmason/sdk` host interface), so the §3 claims are exercised end-to-end here and not just asserted.

## 7. NFRs

- p95 canvas interactive < 300 ms after data (inherits the core budget); remote fetch outside the critical path via lazy activation.
- WCAG 2.1 AA including edit mode.
- Lighthouse CI + Playwright e2e (boot, add-widget gating, governance resolution, error boundary, sideload gate) in-repo.

## 8. Dependencies

`@gridmason/core` · `@gridmason/protocol` (contract types + verification lib) · `@gridmason/sdk` (host interface it implements + widget helpers) · one or more Gridmason Registries (resolution API + CDN — flagship or self-hosted; trust roots pinned at build time or via the deploy-time trust-root config, registry spec §2) · `@gridmason/cli` (dev loop). Theming via CSS custom properties; ships the default Gridmason theme. Pure consumer — publishes nothing to npm; releases as a deployable app image + static bundle. **License: AGPL-3.0 (GW-D8, CLA required).**

## 9. Milestones

1. **M1 — static boot**: PageCanvas + demo page types + first-party widgets from a local import map (no registry).
2. **M2 — federated boot**: gate snapshot → registry resolution API → signed remote verification → lazy mount.
3. **M3 — hardening**: CSP, Service-Worker token + hash verification, sideload policy modes, telemetry/auto-degrade.
4. Exit: the end-to-end proof — a third-party-published widget renders on a governed, locked page, from both the flagship and a self-hosted registry.
