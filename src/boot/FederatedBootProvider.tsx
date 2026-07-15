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
import type { FederatedRegistryConfig } from './federated-config';

/**
 * The deployment's federated config, or `null` when no registry is federated. The
 * showcase ships `null` (no live registry configured yet); a deployment that
 * federates supplies its {@link FederatedRegistryConfig} here. Kept a function (not
 * a constant) so a future config source — a served config file or build-time env —
 * drops in behind this one seam without touching the provider.
 */
export function loadFederatedConfig(): FederatedRegistryConfig | null {
  return null;
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
  config = loadFederatedConfig(),
  deps,
}: {
  children: ReactNode;
  /** The federated config; defaults to {@link loadFederatedConfig}. A harness may override it. */
  config?: FederatedRegistryConfig | null;
  /** Injected boot collaborators (fetch/verify/clock/import); defaulted for production. */
  deps?: FederatedBootDeps;
}): React.JSX.Element {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    // No registry federated (the default): install nothing, so the render path sees
    // no federated remote in the import map. Exactly the Phase-A canvas.
    if (config === null) {
      installFederatedHost(null);
      return;
    }

    let active = true;
    void (async () => {
      let result: FederatedBootResult;
      try {
        result = await bootFederated(config, deps ?? {});
      } catch {
        // Fail closed: a resolution failure installs no federated remote (SPEC §2).
        // The deployment still renders its shell-bundled + acknowledged widgets.
        return;
      }
      if (!active) return;
      installFederatedHost({
        remotes: () => result.remotes,
        describe: (id: WidgetID) => {
          const match = result.remotes.find(
            (remote) => remote.source === id.source && remote.tag === id.tag,
          );
          return match?.name;
        },
      });
      // Signal the render path that verified remotes are now installable.
      setGeneration((g) => g + 1);
    })();

    return () => {
      active = false;
      installFederatedHost(null);
    };
  }, [config, deps]);

  return <FederatedBootContext.Provider value={generation}>{children}</FederatedBootContext.Provider>;
}
