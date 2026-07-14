# Sideload (operator guide)

Sideload lets a dashboard load a widget that did **not** come through the signed
registry. It exists for the widget-author loop and for operators who deliberately
choose to run their own unreviewed remotes. It is a **host-configurable policy**:
Gridmason does not dictate your risk posture, it makes every posture explicit and
off by default.

> **Phase-A honesty note:** no verify chain yet — run only widgets you built or
> reviewed yourself.

That caveat is load-bearing. Phase A ships hash-pinning at registration, but there
is **no signed, logged verification chain yet** (that is the Phase-B Service-Worker
path). Hash-pinning ties a remote to bytes an operator recorded; it does **not**
prove those bytes were reviewed, and it does not close the fetch-time-of-check /
run-time-of-use window. The only real safeguard in Phase A is your own review — so
run only widgets you built or reviewed yourself.

## Modes

Sideload has three modes (SPEC §4). **`off` is the default.**

| Mode | What loads | CSP |
|---|---|---|
| `off` (default) | registry-signed remotes only | production CSP, never relaxed |
| `dev` | + local dev-server remotes, per-session allowlist, nothing persisted | a dev build adds the localhost origin to `script-src` **only while the dev gate is on** |
| `acknowledged` | + persistent, owner-acknowledged remotes registered **by URL** (never inline/`base64` code) | each acknowledged origin is added to `script-src` by explicit owner action, recorded in config |

Common to `dev` and `acknowledged`: unlocked only by an explicit, disclaimed owner
acknowledgement (you accept the risk of unreviewed code); every sideloaded widget is
marked distinctly in the UI (a badge on its card and its picker entry); and the
**production CSP is never silently relaxed** — every sideload origin present in
`script-src` is visible in the deployment's config.

## `off` is the default, and it blocks

With no mode set, sideload is off, and off means off:

- **No remote enters the import map.** The client posture defaults to `off`
  (`src/sideload/policy.ts`); with it off the acknowledged provider never fetches,
  resolves, or installs a registration, so nothing an operator (or a compromised
  registration store) added can reach the render path. Proven by the
  `e2e/sideload-gate.spec.ts` off-default flow.
- **No origin enters `script-src`.** The server config posture defaults to `off`
  (`server/config`, `sideload.mode`); the config-recorded `script-src` additions it
  authorizes are empty unless the posture is explicitly `acknowledged`. The
  production CSP is never relaxed by default.

Both switches are independent and both default off. In a single-origin deployment
you set both to the same value; the demo wires the client posture per surface so its
end-to-end matrix can exercise both the blocked and the enabled paths.

## Enabling a mode

Enabling a mode is a deliberate operator action, and every enable surface repeats
the caveat above verbatim:

- **`dev`** — start the dev server with `GRIDMASON_DEV_SIDELOAD=1` (delivers the
  dev-only `script-src` relaxation) and bake the client posture with
  `GRIDMASON_SIDELOAD_MODE=dev`. In the dashboard, the Add-widget picker still
  requires an in-session acknowledgement before it will admit a remote. Dev sideload
  ships in **development builds only** — a production build drops it entirely.
- **`acknowledged`** — set `sideload.mode` to `acknowledged` in the server config and
  bake the client posture with `GRIDMASON_SIDELOAD_MODE=acknowledged`. An owner then
  registers each remote **by URL**; registration pins the entry's content hash and
  records who acknowledged the risk. The pin is verified before the module runs, and
  a mismatch refuses the load.

Whichever mode you enable: no verify chain yet — run only widgets you built or
reviewed yourself.

## The `gridmason dev` serving contract (dev sideload)

Dev sideload admits a remote served by `gridmason dev` (`@gridmason/cli`). The
dashboard's seam (`src/sideload/manifest.ts`, `fetchDevManifest`) is reconciled
against the **real** contract, verified against `@gridmason/cli@0.0.1` (issue #38,
reported on gridmason/cli#28):

| What | Endpoint | Shape |
|---|---|---|
| Live, re-validated manifest | `GET /@dev/manifest` | `{ valid, violations, tag, entry }` |
| Raw manifest (display name) | `GET /manifest.json` | the widget's `manifest.json` (has `name`) |
| Entry module | `GET /<entry>` (e.g. `/src/entry.js`) | the entry source, served **verbatim** |
| Hot-reload signal | `GET /@dev/events` (SSE) | `event: reload` `{ category, generation }` |

The dashboard reads `tag` + `entry` from `/@dev/manifest` (refusing a manifest the
server flags `valid: false`), resolves the **project-relative** `entry` against the
origin, and reads the display `name` best-effort from `/manifest.json` (falling back
to the tag). `gridmason dev`'s dev-only routes are namespaced under `/@dev/` so they
never collide with a widget source path served from the project tree.

### What works today

Verified end to end in a real browser against real `gridmason dev`
(`npm run e2e:real-cli`, below): register origin → hot-load → distinct badge →
mount through the shared `PageCanvas` + SDK path → **live hot-reload on re-serve**
→ per-session (a reload clears it).

### Live hot-reload (issue #41)

While a dev origin is on the session allowlist, the dashboard subscribes to its
`GET /@dev/events` SSE stream (`src/sideload/dev-events.ts`) and reacts to each
`reload` frame by **remounting that origin's live widget instances** — no re-add,
no manual page reload. The subscription is dev-only and torn down with the
session/origin (the gate is revoked, the remote removed, or the provider unmounts).

- `source` / `manifest` (generation bumped): the entry is re-imported at
  `?v=<generation>` (a cache-busting fetch that also surfaces a broken edit as a
  load error), then the instances remount.
- `fixtures` / `context` (generation reused): a **hot data swap** — the instances
  remount without a re-import.

**The honest tradeoff.** A custom-element **tag can be defined only once per
document**, so re-importing a fresh entry re-runs `customElements.define` as a
no-op and the *old* class stays registered. The standalone `gridmason dev` harness
sidesteps this with a **full-document reload**; the dashboard cannot reload the
whole document without tearing down the session, so it does a **scoped remount**
instead (`src/sideload/remount.ts`): it re-runs the widget's mount lifecycle, which
lands any change the widget **re-reads on mount** (data/content it fetches), but it
does **not** swap the element class in place — a change to the widget's own code is
not reflected live. A true in-place code swap would need a per-generation *versioned
tag*, which the dashboard cannot impose because `gridmason dev` serves the entry
source verbatim (its `define` call hardcodes the tag). For a code change, restart
the mount via the picker or reload the page.

### Scaffold-template widgets: the shared `@gridmason/*` import scope

`gridmason dev` serves a widget's entry source **verbatim**, and the scaffold
templates import `@gridmason/sdk` (and, for author-facing types, `@gridmason/protocol`)
by **bare specifier**. When the dashboard `import()`s that entry directly the
browser has to resolve those specifiers, and with nothing to resolve them against a
bare import throws `Failed to resolve module specifier "@gridmason/sdk"`.

The **dev server** closes this by injecting a `@gridmason/*` import map (issue #40,
`vite/dev-sideload-import-scope.ts`): while the dev gate is on
(`GRIDMASON_DEV_SIDELOAD=1`) it prepends a `<script type="importmap">` that maps
`@gridmason/sdk`, `@gridmason/sdk/vanilla`, and `@gridmason/protocol` to the
dashboard's **own pinned copies** (the versions in the dashboard's `package.json`,
served by Vite and deduped with the app's own SDK). A sideloaded widget's bare
import therefore resolves to the dashboard's SDK instead of failing. The map is a
top-level `imports` block injected once, up front — safe because in a dev build the
app's own modules never carry a bare `@gridmason/*` specifier (Vite pre-resolves
every one), so the map is consulted **only** by verbatim-served sideloaded modules
and cannot change how the app loads its own SDK.

This is a **dev-server-only** convenience: it rides the same
`GRIDMASON_DEV_SIDELOAD` opt-in as the dev CSP relaxation, and a production
`vite build` injects no map (dev sideload ships in development builds only).

**Still out of scope: framework specifiers.** A React or Vue scaffold widget also
imports its framework (`react` / `vue`) by bare specifier, and those are **not**
mapped (issue #40 is `@gridmason/*` only; the dashboard does not even depend on
`vue`). So a **vanilla** scaffold widget (SDK + protocol, no framework import) loads
end to end today; a React/Vue one still needs its framework resolved, which is a
later enhancement (or `gridmason dev` learning to rewrite bare specifiers itself —
gridmason/cli#28).

## Continuous verification

CI stays **hermetic**: the default Playwright matrix (`npm run e2e`) drives a
contract-faithful stand-in (`e2e/fixtures/dev-widget-server.mjs`) that mirrors the
`gridmason dev` contract above — no network, no published-package download. The
stand-in widget is deliberately self-contained so the e2e is a pure test of the
transport + governance path.

An **optional, non-hermetic** check runs the same author loop against the real
published CLI:

```
npm run e2e:real-cli
```

It stands up the demo API, `vite dev` (dev gate on), and
`npx @gridmason/cli@0.0.1 dev` serving `e2e/fixtures/real-cli-widget/`
(`playwright.real-cli.config.ts`), then registers the real origin and asserts the
widget mounts with its badge. It is excluded from the default matrix because it
downloads and runs `@gridmason/cli` over the network; run it deliberately when
validating against a new CLI release (override the version with
`GM_E2E_CLI_VERSION`).
