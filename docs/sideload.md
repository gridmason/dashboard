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
