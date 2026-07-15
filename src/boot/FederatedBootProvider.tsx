/**
 * The **federated-boot provider** (docs/SPEC.md §2; FR-10) — runs the async
 * federated boot once and installs the {@link FederatedHost} seam the canvas render
 * path reads. The Phase-B sibling of the acknowledged-sideload provider
 * (../sideload/AcknowledgedSideloadContext): where that resolves acknowledged
 * origins, this resolves a registry's enabled remotes, verifies each release, and
 * exposes only the verified ones to the render path.
 *
 * **Inert by default.** {@link loadFederatedConfig} returns `null` until a
 * deployment configures a registry (endpoint + serving origin + trust material,
 * ../boot/federated-config), so the showcase ships with no federation: the provider
 * installs nothing, `federatedHost()` stays `null`, and the canvas behaves exactly
 * as Phase A. A deployment that federates supplies a config (or a harness passes one
 * via the `config` prop) and its verified remotes appear on the canvas.
 *
 * **Fail closed (SPEC §2).** A resolution failure (transport / non-2xx / malformed)
 * throws out of {@link bootFederated}; this provider swallows it and installs
 * nothing — the deployment renders its shell-bundled and acknowledged widgets, but
 * no unverified federated remote ever reaches the import map. A release that fails
 * verification is already dropped inside the boot (it lands in `refused`, never in
 * `remotes`), so a partial-failure boot still installs the remotes that *did* verify.
 *
 * **Late arrival.** The boot is async (resolve + verify), so it typically completes
 * after the first canvas render. On completion the provider bumps a generation
 * counter it provides through context; `CanvasHost` reads it as an effect
 * dependency, so its lazy-mount effect re-runs and picks up the newly-installed
 * federated remotes — a federated widget already in the saved layout upgrades from
 * its fallback card to its real element once its release verifies, with no reload.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { WidgetID } from '@gridmason/protocol';

import { bootFederated, type FederatedBootDeps, type FederatedBootResult } from './federated-boot';
import { installFederatedHost } from './federated-host';
import { federatedKilledInstanceIds } from './federated-kills';
import { FederatedConfigError, type FederatedRegistryConfig } from './federated-config';
import { loadFederatedConfig } from './federated-config-loader';
import { FederatedConfigErrorBanner } from './FederatedConfigErrorBanner';
import { isStaticDemo } from '../adapters/backend';
import { establishFederatedSwControl } from './sw/register-federated-sw';
import type { MultihashString } from '@gridmason/protocol/verify';

/**
 * **Control-before-import-map gate** (SPEC §2; FR-11). A verified federated remote may
 * become mountable **only** once the shell's Service Worker controls the page and is
 * enforcing the release-doc `url → hash` table — the SW is the per-fetch check that
 * makes `import()` of a remote safe (a mismatched or unclaimed byte becomes a network
 * error). Resolves `true` when it is safe to install the remotes, `false` to fail
 * closed (no federated remote loads without the verifying SW in front of it).
 *
 * **Dev bypass (documented decision, SPEC §4 / docs/SPEC.md Risks).** In a development
 * build the Vite dev server serves modules the verifying SW cannot sit in front of
 * without fighting HMR, so the SW is **bypassed with loud labeling** — federated
 * remotes load by direct `import()`, unverified. `import.meta.env.DEV` is a static
 * `false` in a production build, so this branch and its warning are stripped there and
 * production always goes through the SW.
 */
async function establishFederatedControl(
  urlHashes: ReadonlyMap<string, MultihashString>,
): Promise<boolean> {
  if (import.meta.env.DEV) {
    console.warn(
      '[gridmason] DEV BUILD: Service-Worker hash verification is BYPASSED for ' +
        'federated remotes — they load unverified. This is a dev-only ergonomics ' +
        'decision (SPEC §4); production builds always verify. Do NOT rely on dev for trust.',
    );
    return true;
  }
  const controlled = await establishFederatedSwControl(urlHashes);
  if (!controlled) {
    console.warn(
      '[gridmason] Service Worker unavailable or uncontrolled — failing closed: ' +
        'no federated remote will load (SPEC §2). Shell-bundled widgets are unaffected.',
    );
  }
  return controlled;
}

/**
 * A monotonically increasing token that changes when the installed federated-boot
 * result changes (0 before the boot completes). `CanvasHost` reads it as an effect
 * dependency so its mount effect re-runs when verified remotes become available.
 */
const FederatedBootContext = createContext<number>(0);

/** The current federated-boot generation — `0` outside a provider or before the boot completes. */
export function useFederatedGeneration(): number {
  return useContext(FederatedBootContext);
}

export function FederatedBootProvider({
  children,
  config,
  deps,
}: {
  children: ReactNode;
  /**
   * The federated config. Omitted (the normal case): the provider **loads** it from
   * the deployment (`loadFederatedConfig`, `<base>/federated.json`). A harness may
   * inject one directly — a `FederatedRegistryConfig` to boot, or `null` to force the
   * inert path — which skips the load.
   */
  config?: FederatedRegistryConfig | null;
  /** Injected boot collaborators (fetch/verify/clock/import); defaulted for production. */
  deps?: FederatedBootDeps;
}): React.JSX.Element {
  const [generation, setGeneration] = useState(0);
  // The config loaded from the deployment (when `config` was not injected), and the
  // loud surface for a malformed one (SPEC §4.4 fail-loud, issue #80).
  const [loadedConfig, setLoadedConfig] = useState<FederatedRegistryConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Load the deployment's federated config once, unless a config was injected (a
  // harness override) or this is the serverless static-demo build (federation is a
  // server-backed concern, Phase B — the static showcase never federates).
  useEffect(() => {
    if (config !== undefined || isStaticDemo()) return;
    let active = true;
    void (async () => {
      try {
        const loaded = await loadFederatedConfig();
        if (active && loaded !== null) setLoadedConfig(loaded);
      } catch (error) {
        // A served-but-malformed config: surface it loudly rather than staying inert.
        if (active) {
          setConfigError(
            error instanceof FederatedConfigError ? error.message : String(error),
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [config]);

  // The config to boot: an injected one wins; otherwise whatever was loaded (null
  // until the load resolves, and null forever if none is served — both inert).
  const effectiveConfig = config !== undefined ? config : loadedConfig;

  useEffect(() => {
    // No registry federated (the default, or before the async load resolves): install
    // nothing, so the render path sees no federated remote. Exactly the Phase-A canvas.
    if (effectiveConfig === null) {
      installFederatedHost(null);
      return;
    }

    let active = true;
    // Abort the in-flight boot's fetches when the provider unmounts (or config/deps
    // change) so a slow resolve/verify/feed call is cancelled rather than left to
    // settle against a torn-down provider. `bootFederated` threads this signal into
    // its resolution and revocation-feed fetches.
    const controller = new AbortController();
    void (async () => {
      let result: FederatedBootResult;
      try {
        result = await bootFederated(effectiveConfig, { ...(deps ?? {}), signal: controller.signal });
      } catch {
        // Fail closed: a resolution failure installs no federated remote (SPEC §2).
        // The deployment still renders its shell-bundled + acknowledged widgets.
        return;
      }
      if (!active) return;
      // Control-before-import-map (SPEC §2; FR-11): only gate on the verifying SW when
      // there are verified remotes whose code would actually run. With nothing to
      // mount (all refused/excluded, or a killed set), there is no federated `import()`
      // to protect, so the host still installs for its refusal/fallback cards — exactly
      // the pre-#19 behaviour — without registering a SW (showcase stays a no-op).
      if (result.remotes.length > 0) {
        const controlled = await establishFederatedControl(result.urlHashes);
        if (!active) return;
        // Fail closed: no SW control → no federated remote enters the active import map.
        if (!controlled) return;
      }
      installFederatedHost({
        remotes: () => result.remotes,
        describe: (id: WidgetID) => {
          const match = result.remotes.find(
            (remote) => remote.source === id.source && remote.tag === id.tag,
          );
          return match?.name;
        },
        killedInstanceIds: (mounted) =>
          federatedKilledInstanceIds(mounted, result.verdicts, result.versions),
      });
      // Signal the render path that verified remotes are now installable.
      setGeneration((g) => g + 1);
    })();

    return () => {
      active = false;
      controller.abort();
      installFederatedHost(null);
    };
  }, [effectiveConfig, deps]);

  return (
    <FederatedBootContext.Provider value={generation}>
      {configError !== null ? <FederatedConfigErrorBanner message={configError} /> : null}
      {children}
    </FederatedBootContext.Provider>
  );
}
