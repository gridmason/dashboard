/**
 * Turn a **verified** resolved module into a mountable {@link LocalRemote} the
 * canvas render path can carry (docs/SPEC.md §2; FR-10) — the federated sibling of
 * the acknowledged-sideload loader (../sideload/acknowledged-remotes).
 *
 * A federated remote's `load` thunk is a bare native dynamic `import()` of its
 * **absolute, hash-pinned entry URL** — no fetch-then-verify inside the thunk,
 * because the release chain was already verified *before* this remote was created
 * (../boot/release-verification): a module that did not verify never reaches
 * {@link federatedRemote}, so an unverified URL is never in the import map to be
 * imported (fail closed, SPEC §2). The remaining per-fetch check — does the served
 * entry's exact bytes hash to the release's listed hash? — is enforced by the D-E4
 * Service Worker (#19) against the `url → hash` table verification produced; it is
 * not re-done in this thunk.
 *
 * Loading is native ESM by absolute URL (GW-D22: no Module-Federation runtime). The
 * `import()` is `@vite-ignore`d so the bundler leaves the runtime URL alone rather
 * than trying to resolve a federated CDN artifact at build time — exactly as the
 * acknowledged loader imports its verified entry.
 */
import type { LocalRemote } from './import-map';
import type { VerifiedModule } from './release-verification';

/** Injectable collaborators for {@link federatedRemote} — defaulted for production, overridden in tests. */
export interface FederatedRemoteDeps {
  /**
   * How a verified entry URL is imported (registering its custom element).
   * Defaults to a native dynamic `import()`; injectable so a test can assert the
   * module is imported by exact URL — and only on activation, never at boot.
   */
  readonly importModule?: (entryUrl: string) => Promise<unknown>;
}

/**
 * Build the mountable import-map entry for one verified federated module. Its
 * identity is the resolved module's source-qualified `(source, tag)` and bare
 * `specifier`; its display `name` is the tag (a resolved module carries no separate
 * human name — the tag is publisher-prefixed and is what the fallback card shows).
 * The `load` thunk imports the verified absolute URL on activation.
 */
export function federatedRemote(
  verified: VerifiedModule,
  deps: FederatedRemoteDeps = {},
): LocalRemote {
  const importModule = deps.importModule ?? ((entryUrl: string) => import(/* @vite-ignore */ entryUrl));
  const module = verified.module;
  return {
    tag: module.tag,
    source: module.source,
    name: module.tag,
    specifier: module.specifier,
    load: () => importModule(module.url),
  };
}
