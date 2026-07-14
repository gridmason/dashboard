# Contributing to Gridmason Dashboard

Thanks for your interest in Gridmason. This repo is the product-neutral dashboard app — the platform's end-to-end proof and the widget-author dev target.

## Contributor License Agreement — required

Every contribution requires an accepted **[CLA](CLA.md)**. Gridmason is AGPL-3.0 **and** embedded proprietarily in Sniper7Kills LLC's products; the dual-licensing model only holds if contributions are licensed to permit it. First-time contributors are prompted to accept the CLA on their first pull request — a PR cannot merge until it is accepted.

## Development setup

Requires Node `>= 22.12`.

```bash
npm install
npm run dev            # Vite dev server at http://localhost:5173
```

Before opening a PR, make sure the checks CI runs pass locally:

```bash
npm run build          # tsc --noEmit + vite build (static bundle)
npm run build && npm run e2e   # Playwright boot smoke test against the built bundle
```

(One-time: `npm run e2e:install` to fetch the Playwright browser.)

## Ground rules

- **Product-neutral.** No references to Sniper7Kills LLC's downstream products in code, tests, or docs. Gridmason is standalone OSS; the products consume it as external supply chain only.
- **The no-special-case-pages invariant.** Every route resolves a `{ pageType, entityId? }` and renders the single generic canvas host. Do not add per-page-type components — add page types and widgets as data/registrations. See the README.
- **Dependencies from npm, pinned exact.** Consume `@gridmason/*` from npm at exact versions (`.npmrc` sets `save-exact`). Never add file/git deps on sibling Gridmason repos — cross-repo changes are contract-first version bumps.
- **Publishes nothing to npm.** The dashboard releases as an app image + static bundle only; do not add an npm publish step.
- **TypeScript strict.** The project builds under `strict` with `noUnusedLocals`/`noUnusedParameters`/`exactOptionalPropertyTypes` and more; keep `npm run typecheck` clean.

## Pull requests

- Keep PRs focused; reference the issue they address.
- Write imperative commit subjects.
- Cross-repo needs (a contract change in `@gridmason/core`, `sdk`, `protocol`, etc.) are raised as **issues on that Gridmason repo**, linked from here — never as a dependency edit in this repo.

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and your environment (Node version, browser).
