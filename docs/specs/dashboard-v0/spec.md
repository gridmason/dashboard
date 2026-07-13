---
name: Gridmason Dashboard v0
slug: dashboard-v0
status: approved
created: 2026-07-13
approved: 2026-07-13
---

# Gridmason Dashboard v0

## Overview

The Gridmason Dashboard is the permanent, product-neutral app over `@gridmason/core` + a Gridmason Registry (GW-D3): the end-to-end proof, the OSS showcase, and the widget-author dev target. Built in React (GW-D16); single-tenant pre-1.0 (GW-D21). It also owns the **reference `HostSDK` implementation** — the code that makes the SDK's enforcement claims real.

Full engineering spec: [`docs/SPEC.md`](../../SPEC.md). **Phase A:** static boot (M1) + the dev/acknowledged sideload loop. **Phase B:** federated boot (M2) + hardening (M3: Service-Worker verification, CSP, identity binding).

## Goals

- Phase A exit: an author scaffolds a widget with the CLI and sees it live on a governed page, with data, in one sitting.
- Phase B exit: a third-party-published widget renders on a governed locked page from both the flagship and a self-hosted registry, fully verified.
- Deployable for real (app image + static bundle), not a demo harness.

## Non-goals

- Product features (org trees, real RBAC — stubs behind adapters). Registry internals. Multi-user authn/SSO (GW-D21). Heavy theming — minimal default theme; hosts theme via CSS custom properties.

## Users & personas

- **Widget authors** — dev target (`gridmason dev` sideload).
- **Small teams** — actually run it as a dashboard.
- **Product-shell engineers** — read the reference adapters/SDK impl as documentation.

## Functional requirements

- **FR-1** React shell + routing; every route renders core's `PageCanvas` (no special-case pages) (SPEC §1–2).
- **FR-2** Demo page types: `dashboards.home`, `demo.record-detail` (typed record-ref context + locked header slot), `demo.locked`, `demo.full-canvas` (SPEC §5).
- **FR-3** First-party demo widgets exercising the whole ABI: clock, markdown, record-summary (context consumer), settings-heavy chart, deliberate crasher (error-boundary demo) (SPEC §5).
- **FR-4** Governance demo: org layout with locks published → user override → reset (SPEC §5).
- **FR-5** Reference adapters: API-backed KV layout persistence keyed `(scope|user, pageType, entityId?)`; config-file gates merged (B) with revocation feeds; role-stub permissions; console/OTLP telemetry (SPEC §6).
- **FR-6** Single-tenant auth stub: config-file users, stub login (GW-D21).
- **FR-7** `dev` sideload: per-session allowlist for `gridmason dev` remotes, nothing persisted, dev builds only (SPEC §4).
- **FR-8** `acknowledged` sideload: owner-acknowledged, URL-registered, hash-pinned at registration, distinct UI badges, config-visible origins; `off` default (SPEC §4). **Phase-A honesty note in docs: no verify chain yet — run only widgets you built or reviewed.**
- **FR-9** Reference `HostSDK` implementation passing the SDK conformance suite; demo API implements `min(user, widget)` + remote-identity checks as reference code (SPEC §6). *(B; a fixture/no-op-backed interim handle ships in A)*
- **FR-10** Federated boot: gate snapshot → registry resolution API → import-map assembly (+ `scopes`) → lazy `import()` of verified entries (SPEC §2). *(B)*
- **FR-11** SW verification: buffer-verify-serve by exact URL+hash against the owning registry's release doc; unclaimed URL refused; import map assembled only after SW controls the page; SW unavailable → shell-bundled content only (SPEC §2). *(B)*
- **FR-12** Gate = kill switch: disabled remote never enters the import map; per-registry feed cursors + TTL, fail-closed scoped (SPEC §2). *(B)*
- **FR-13** CSP: `script-src` shell + registry CDNs; `connect-src` API + registry CDNs; sideload modes alter CSP only as specified; scoped fetch proxied through the host API (SPEC §3). *(B)*
- **FR-14** Token hardening + per-instance identity: session token in SW; shell-minted instance tokens per SDK contract; API rejects capability calls without binding (SPEC §3, with sdk S-E3). *(B)*
- **FR-15** Telemetry + auto-degrade: widget-attributed error/latency; budget-exceeding widget degraded to fallback (SPEC §3). *(B)*
- **FR-16** NFRs: p95 canvas < 300 ms after data; WCAG 2.1 AA incl. edit mode; Lighthouse CI + Playwright e2e (boot, picker gating, governance, error boundary, sideload gate) (SPEC §7).
- **FR-17** Releases as deployable app image + static bundle; publishes nothing to npm (SPEC §8).

## Architecture & stack

React + TS, Vite. Deps: `@gridmason/core`, `@gridmason/protocol`, `@gridmason/sdk`; dev loop uses `@gridmason/cli`. Demo API: small Node service in-repo (reference SDK enforcement lives here in B). Theming: CSS custom properties, default Gridmason theme.

## Data model

Layout KV `(scope|user, pageType, entityId?) → LayoutDoc` (demo API). Config: users, gates, sideload registrations `{url, hash, acknowledgedBy, at}`.

## Screens & UX

Mockups in [`mockups/`](mockups/) (carried from the approved planning baseline; interaction names are canonical for issue workers):

- **Canvas** — [`mockups/01-canvas.html`](mockups/01-canvas.html): `dashboards.home` grid, widget cards, sideload badge.
- **Edit mode** — [`mockups/02-edit-mode.html`](mockups/02-edit-mode.html): drag/resize handles, add/remove, tabs, lock indicators.
- **Add-widget picker** — [`mockups/03-add-widget-picker.html`](mockups/03-add-widget-picker.html): gated catalog, context-match filtering.
- **Governance** — [`mockups/04-governance.html`](mockups/04-governance.html): org publish with locks, user override, reset-to-default.

## Epics & issues

### Epic: D-E0 Bootstrap
Goal: deployable empty shell with CI.
Depends on: core C-E3 usable (canvas), sdk S-E1 on npm

- [ ] App scaffold: Vite + React + routing + CI (build, Playwright harness, Lighthouse stub) + community files
      FRs: FR-1, FR-17
      Acceptance: CI builds image + static bundle; empty page renders
- [ ] Demo API service skeleton + layout KV store + config loading (users/gates)
      FRs: FR-5, FR-6
      Acceptance: KV round-trip; stub login gates routes
      Depends on: App scaffold

### Epic: D-E1 Static boot (Phase A — SPEC M1)
Goal: governed widget pages, all local, no registry.
Depends on: D-E0

- [ ] PageCanvas integration + demo page types (all four) from a local import map
      FRs: FR-1, FR-2
      Acceptance: each page type renders its default layout; full-canvas page proves no-special-case
- [ ] First-party demo widgets (clock, markdown, record-summary, chart, crasher)
      FRs: FR-3
      Acceptance: ABI attrs consumed; crasher triggers fallback card only for itself
      Depends on: PageCanvas integration
- [ ] Interim SDK handle (fixture/no-op-backed) wired per mount
      FRs: FR-9 (interim)
      Acceptance: record-summary reads context record through the handle; per-instance identity distinct
      Depends on: PageCanvas integration
- [ ] Layout persistence through the demo API + copy-on-write behavior visible
      FRs: FR-5
      Acceptance: user edit persists across reload; reset-to-default works
      Depends on: PageCanvas integration
- [ ] Governance demo flow (org publish → user override → reset)
      FRs: FR-4
      Acceptance: matches mockup 04 interactions; locks immovable in user mode
      Depends on: Layout persistence

### Epic: D-E2 Dev loop + sideload (Phase A)
Goal: the author loop + explicit-risk sideload, with the honesty note.
Depends on: D-E1; cli L-E1

- [ ] `dev` sideload: per-session allowlist consuming `gridmason dev` remotes, dev builds only
      FRs: FR-7
      Acceptance: CLI-served widget hot-loads; allowlist gone after session
- [ ] `acknowledged` sideload: URL registration + hash pin + owner acknowledgement flow + badges
      FRs: FR-8
      Acceptance: hash mismatch on load → refused + telemetry; badge on card and picker entry
- [ ] Phase-A security honesty docs + `off` default enforcement + e2e for the sideload gate
      FRs: FR-8, FR-16
      Acceptance: docs state the no-verify-chain caveat verbatim; e2e proves `off` blocks

### Epic: D-E3 Federated boot (Phase B — SPEC M2)
Goal: signed remotes from a real registry.
Depends on: D-E2; registry R-E2; protocol P-E3

- [ ] Gate snapshot + resolution-API client + import-map assembly with `scopes`
      FRs: FR-10
      Acceptance: registry fragment merges with local map; prefix-pin conflict rejected as config error
- [ ] Lazy verified mount path: `import()` on route/slot activation, release-doc plumbing
      FRs: FR-10
      Acceptance: third-party widget from a compose registry renders on a governed page
      Depends on: Gate snapshot
- [ ] Revocation feed consumption: per-registry cursors, TTL, fail-closed scoping
      FRs: FR-12
      Acceptance: killed remote drops from import map without deploy; stale registry blocks only its own remotes
      Depends on: Gate snapshot

### Epic: D-E4 Hardening (Phase B — SPEC M3)
Goal: the security claims, exercised end to end.
Depends on: D-E3; sdk S-E3

- [ ] Service Worker: buffer-verify-serve by URL+hash, unclaimed-URL refusal, control-before-import-map, SW-unavailable fail-closed
      FRs: FR-11
      Acceptance: tampered chunk → network error + fallback card; first-load race test passes
- [ ] CSP: production policy + per-mode sideload handling + scoped-fetch proxy endpoint
      FRs: FR-13
      Acceptance: CSP report-only run clean on demo flows; `net:<host>` widget works only via proxy
- [ ] Token + instance identity: session token in SW, shell-minted instance tokens, API-side capability enforcement (reference SDK impl completes)
      FRs: FR-9, FR-14
      Acceptance: SDK conformance suite green on the reference impl; SDK-bypassing widget gets `PermissionDenied`
- [ ] Telemetry + auto-degrade + NFR gate: Lighthouse CI, full Playwright matrix, perf budget
      FRs: FR-15, FR-16
      Acceptance: budget-buster widget auto-degrades; e2e matrix green; Phase B exit demo scripted

## Milestones

1. **M-A1:** D-E0 + D-E1 — static boot demo (project's first demoable moment).
2. **M-A2 (Phase A exit for the whole project):** D-E2 — author loop live end to end with the CLI.
3. **M-B (Phase B exit):** D-E3 + D-E4 — verified third-party widget on a governed page from flagship + self-hosted registry.

## Risks & open questions

- SW-in-dev ergonomics (Vite dev server vs verifying SW) — dev builds may bypass SW with loud labeling; decide in D-E4 issue 1.
- Import-map dynamism (updating after gate changes without full reload) — acceptable to require reload in v0; note in D-E3 issue 1.

## Changelog

- 2026-07-13 — initial draft from the approved engineering spec set.
