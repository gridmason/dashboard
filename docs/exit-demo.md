# Phase B (D-E4) exit demo

The scripted, runnable proof that the hardening epic's contract holds end to end:
a **governed, locked page** renders a **verified federated widget**, every
capability-gated call is **token-enforced**, and a **revocation kill switch** cuts
a running instance off from data. This is the D-E4 exit demo (FR-9, FR-11, FR-12,
FR-14, FR-15, FR-16; SPEC §2, §3, §7).

It is deliberately **decision-free about the registry**: the parts that need a
running Gridmason Registry (release resolution, release-document verification, the
revocation feed) are not yet available (blocked on registry `R-E1–R-E3` and cli
`L-E3/L-E4`). Where a live registry is required, the demo drives the **exact
hand-offs the federated boot performs** against mocks and this document says so —
so when the registry fixture lands, each mocked hand-off is swapped for the real
one with no change to what is being proven.

## Run it

```bash
npm run build          # the exit demo runs against the production preview bundle
npm run e2e -- exit-demo.spec.ts telemetry.spec.ts perf.spec.ts
```

- `e2e/exit-demo.spec.ts` — the four exit-demo steps below, scripted.
- `e2e/telemetry.spec.ts` — the telemetry + auto-degrade showcase (FR-15).
- `e2e/perf.spec.ts` — the canvas-interactive p95 budget (FR-16, SPEC §7).

The full NFR gate (`npm run e2e` + `npm run lighthouse`) runs the whole matrix and
the Lighthouse budgets; see [the CI workflow](../.github/workflows/ci.yml).

## The four steps

### 1. A governed, locked page renders

Route `/p/demo.locked` — a fully locked page type (`allow_user_customization:
false`, every slot locked) — boots and places its widgets through the **one generic
canvas**, with no per-page special-casing (FR-1, FR-4; SPEC §5). The three-level
governance resolution behind a governed page (org publish → user override → reset,
and a locked slot being immovable) is proven in full by
[`e2e/governance.spec.ts`](../e2e/governance.spec.ts); the exit demo asserts the
governed page renders.

- **Runs against:** the local page-type registry + demo governance store. No live
  registry needed.

### 2. The verified federated-widget path

A federated widget's module is fetched through the shell-owned **Service Worker**,
which does **buffer-verify-serve**: it buffers the response, verifies its bytes
against the pinned hash from the release document, and only then serves it — a
tampered artifact is refused as a network error so the `import()` never runs
(FR-11; SPEC §2). The exit demo registers the built `/federated-sw.js`, hands it an
enforcement table over the same `MessageChannel` the boot uses, and asserts:
matching bytes are **served**, tampered bytes are **refused**.

The artifact under test stands in for a **registry CDN release** — the mechanism is
identical whether the release came from the flagship `registry.gridmason.dev` or a
self-hosted instance, because trust is bound **per verified URL**, not per registry.

- **Runs against:** the SW + a real same-origin artifact as the CDN stand-in.
- **Needs the live registry fixture for:** resolving a real widget's release
  document + inclusion proof from a running registry (flagship *and* a self-hosted
  instance) and letting the **federated boot** assemble the enforcement table from
  it, rather than the test handing the table in. The SW verification core it feeds
  is already proven here and in [`e2e/sw-verify.spec.ts`](../e2e/sw-verify.spec.ts)
  + `src/boot/sw/*.test.ts`; only the registry→table resolution is mocked.

### 3. Token enforcement

Every capability-gated API call must carry the unforgeable **per-instance token**
the shell minted at mount and the SDK transport stamps under
`x-gridmason-instance-token`. A widget that reaches the API **around** the SDK has
session auth but no instance token — an anonymous page script — and every gated
route denies it (FR-9/FR-14; SPEC §3 rules 1-3). The exit demo shows, over HTTP:

- a gated `GET /api/records/customer/cust-1` with session auth but **no** instance
  token → **403**;
- after the shell registers the instance-token binding and the call stamps it →
  **200**.

- **Runs against:** the reference-host demo API (`server/`), which is the reference
  implementation of the rail. No live registry needed. The same enforcement is
  covered at the unit level by `server/sdk-identity/*.test.ts` and the
  `@gridmason/sdk` conformance kit (`src/host-sdk/conformance.test.ts`).

### 4. The revocation kill switch

Two facets, both scripted:

- **4a — token revocation (instance layer).** `DELETE /api/sdk/instance` revokes the
  instance token; the same previously-allowed gated call then denies **immediately**
  (403) — a killed instance never reaches data again (FR-12; SPEC §3 rule 6).
- **4b — claim withdrawal (fetch layer).** When an artifact's claim is withdrawn
  from the SW enforcement table (the fetch-layer shape of a `killed` revocation
  verdict), the SW refuses to serve it — the same refusal a tampered artifact gets.

- **Runs against:** the demo API (4a) and the SW (4b).
- **Needs the live registry fixture for:** the **end-to-end app-layer kill** — a
  federated widget *already mounted* on the canvas being force-unmounted when a
  live **revocation feed** publishes a `killed` verdict for its artifact
  (`CanvasHost`'s `unmountKilled` path, driven by `src/boot/revocation-*`). That
  path is unit-covered (`src/boot/revocation-feed.test.ts`,
  `revocation-gate.test.ts`, `federated-kills.test.ts`); driving it end to end needs
  the federated boot wired to a running registry's revocation feed.

## Telemetry + auto-degrade (FR-15)

Not a registry-dependent step, but part of the D-E4 exit surface: the
`demo.telemetry` page ([`e2e/telemetry.spec.ts`](../e2e/telemetry.spec.ts)) shows a
budget-busting widget **auto-degraded to its fallback and flagged**, with the
degrade **attributed to that widget instance** on the telemetry stream (console
exporter; OTLP when `VITE_GM_OTLP_ENDPOINT` is set). The pure decision logic is
unit-tested in `src/adapters/telemetry/budget.test.ts`.

## What needs the live registry fixture — summary

| Exit-demo capability | Scripted today | Needs live registry fixture |
| --- | --- | --- |
| Governed locked page renders | ✅ full | — |
| SW buffer-verify-serve (verified / tampered) | ✅ full | — |
| Registry → enforcement-table resolution (flagship + self-hosted) | mocked hand-off | ✅ `R-E1–R-E3`, `L-E3/L-E4` |
| Token enforcement (deny without / allow with) | ✅ full | — |
| Kill switch — token revocation | ✅ full | — |
| Kill switch — SW claim withdrawal | ✅ full | — |
| Kill switch — app-layer unmount on a live revocation feed | unit-covered | ✅ live revocation feed |
