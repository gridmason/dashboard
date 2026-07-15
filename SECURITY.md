# Security Policy

The Gridmason Dashboard is the **deployable, product-neutral app** over
`@gridmason/core` and a Gridmason Registry — a real dashboard a small team can
run as their own, not just a demo. Its security posture is mostly about **what
it lets into the page**: it enforces a strict production Content-Security-Policy
(`docs/csp.md`), proxies widget network access through a same-origin scoped-fetch
endpoint rather than widening `connect-src`, and — in Phase B — boots federated
remotes only through a verifying Service Worker. The repository also ships a
**demo API** (`server/`) whose stub login is a single-tenant reference, **not**
a production authentication system (GW-D21). We treat reports that undermine the
app's containment posture accordingly.

## Reporting a Vulnerability

**Do not open a public issue, discussion, or pull request for a suspected
vulnerability.** Public disclosure before a fix is available puts every team
running this dashboard, and their users, at risk.

Instead, report privately through GitHub's coordinated disclosure workflow:

1. Go to the **[Security Advisories](https://github.com/gridmason/dashboard/security/advisories/new)**
   page for this repository (Security tab → Report a vulnerability).
2. Provide as much of the following as you can:
   - Affected version(s) or commit(s), and the affected area (e.g. the production
     CSP delivery, the scoped-fetch proxy, sideload acknowledgement, the demo
     API's layout/config/auth handling, or the federated boot path).
   - A description of the issue and its security impact (e.g. a CSP relaxation
     that reaches production, a scoped-fetch path that fetches a host outside a
     widget's declared allowlist, a sideload origin admitted without owner
     acknowledgement, or a demo-API route reachable without the stub login).
   - A minimal reproduction — ideally a failing test or a short script against a
     built bundle or the demo API.
   - Any known workarounds.

If you cannot use GitHub Security Advisories, contact an administrator of the
[`gridmason`](https://github.com/gridmason) GitHub organization directly to
arrange a private channel.

## What to Expect

- **Acknowledgement** within **3 business days** of your report.
- An initial **assessment and severity triage** within **10 business days**.
- Ongoing updates through the advisory thread as we investigate and prepare a
  fix.
- **Coordinated disclosure**: we will agree on a disclosure timeline with you.
  Our target is a fix and published advisory within **90 days** of triage;
  actively-exploited issues are handled faster. We will credit you in the
  advisory unless you ask us not to.

We do not currently operate a paid bug-bounty program.

## Supported Versions

Gridmason is pre-1.0. Security fixes land on the latest `0.x` line; there is no
long-term support for older `0.x` releases. The dashboard publishes nothing to
npm — it releases as a deployable app image and a static `dist/` bundle — so
"latest" means the most recent tagged release. Always run the most recent one,
and keep the `@gridmason/*` packages it pins current.

| Version | Supported |
| ------- | --------- |
| latest `0.x` | :white_check_mark: |
| older `0.x` | :x: |

Once a `1.0` line ships, this table will be updated with a supported-version
window.

## Scope

In scope — anything that lets the app run something it should not, reach a host
it should not, or expose data the deployment should protect:

- **CSP escape**: any path that relaxes the enforced production
  Content-Security-Policy (`docs/csp.md`, `src/security/production-csp.ts`) — for
  example a build that emits `'unsafe-inline'`/`'unsafe-eval'`, or a dev-only
  relaxation (`vite/dev-sideload-csp.ts`) that reaches a production build.
- **Scoped-fetch bypass**: a `net:<host>` widget call that reaches a host outside
  its declared allowlist, or that escapes the same-origin scoped-fetch proxy
  (`server/scoped-fetch`) to open a direct browser connection.
- **Sideload bypass**: a sideload origin admitted to `script-src` without the
  explicit `acknowledged` posture and a recorded owner action (`docs/sideload.md`).
- **Federated-boot integrity** (Phase B): a federated remote that mounts without
  passing verification, or a Service-Worker enforcement gap that lets an
  unverified URL execute.
- **Demo-API auth/isolation**: a route under `/api/*` reachable without the stub
  login, or cross-scope/cross-user access to stored layouts through the reference
  persistence adapter.
- Supply-chain integrity of the app's build and release artifacts (image and
  `dist/` bundle, dependency pinning).

Out of scope:

- The **stub login is not production authn** (config-file users, no real
  authn/SSO — GW-D21). "The demo login accepts a configured demo user" is
  expected behavior, not a vulnerability. Report the *absence* of real
  authentication only where the code claims to provide it.
- Vulnerabilities whose root cause is in a sibling Gridmason repo — the engine
  lives in [`@gridmason/core`](https://github.com/gridmason/core); module
  verification, signatures, and transparency-log logic live in
  [`@gridmason/protocol`](https://github.com/gridmason/protocol). Report those to
  their respective repositories unless the root cause is in this app's use of
  them.
- Issues requiring a maliciously modified local build of the app.
- Reports generated solely by automated scanners without a demonstrated,
  reproducible security impact.

## Disclosure Philosophy

The dashboard's job is to render widgets **honestly and in a box**: a strict,
single-source-of-truth CSP that no widget capability can widen, network access
mediated by a same-origin proxy, and — under federated boot — execution gated on
verification. Its demo API is a reference, not a production security boundary,
and says so. If you have found a way to break the box — get unverified or
disallowed code to run, reach a host a widget was never granted, or read data a
deployment should protect — we want to hear from you before anyone else does.
