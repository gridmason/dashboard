/**
 * The **Add Widget picker** (issue #85; mockup 03-add-widget-picker.html) — the
 * prod-safe surface for placing a widget onto the page being edited. It graduated
 * out of `../sideload/` (where it was a dev-only sideload picker) into the edit
 * feature because its two headline sections are core, every-build functionality:
 *
 * - **First-party** — the shell's local widgets (`./widget-catalog`). Always
 *   placeable in edit mode; inserted as `{ source: 'local', tag }`.
 * - **Registry catalog** — the widgets published by each **registered registry**
 *   (`../catalog/registry-catalog`, contract gridmason/registry#63). A catalog
 *   entry is **addable only if it is gated *and* verified** — present in the boot's
 *   admitted set (`federatedHost().remotes()`); an ungated/unadmitted entry is
 *   listed but disabled with a "not enabled in this deployment" note. Browsing the
 *   catalog never bypasses the deployment gate or the verify chain (owner direction).
 *
 * The **owner-acknowledged** sideload section is prod-safe and shown too; the
 * **dev-sideload** section is dev-only and referenced under `import.meta.env.DEV`,
 * so a production build drops it (`../sideload/production-gate.test.ts`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WidgetID } from '@gridmason/protocol';
import { resolvePageType } from '../pages/page-types';
import type { PageRef } from '../routes';
import { useEditSession } from './edit-session';
import { localCatalogEntries, resolveCatalogAddability } from './widget-catalog';
import { useFederatedConfig, useFederatedGeneration } from '../boot/FederatedBootProvider';
import { federatedHost } from '../boot/federated-host';
import {
  RegistryCatalogError,
  fetchRegistryWidgets,
  widgetsEndpointFor,
  type RegistryWidgetEntry,
} from '../catalog/registry-catalog';
import { useAcknowledgedSideload } from '../sideload/AcknowledgedSideloadContext';
import { ACKNOWLEDGED_BADGE_LABEL } from '../sideload/source';
import { SIDELOAD_NO_VERIFY_CAVEAT } from '../sideload/policy';
import type { AcknowledgedRemote } from '../sideload/acknowledged-store';
import { DevSideloadSection } from '../sideload/DevSideloadSection';
import './add-widget-picker.css';

/** A short label for the typed context a page provides (SPEC §5). */
function contextLabel(pageType: string): string {
  const types = Object.values(resolvePageType(pageType).descriptor.context).map((t) => t.type);
  return types.length > 0 ? [...new Set(types)].join(', ') : 'none';
}

/** Human capability summary (`api` or `api:scope`) for a catalog entry. */
function capabilityLabel(cap: { api: string; scope?: string }): string {
  return cap.scope !== undefined ? `${cap.api}:${cap.scope}` : cap.api;
}

/** The first-party (local) widgets section — always placeable in edit mode. */
function LocalSection({ onPlace }: { onPlace: (widgetID: WidgetID) => void }): React.JSX.Element {
  const entries = localCatalogEntries();
  return (
    <>
      <div className="gm-picker-section">First-party widgets</div>
      <div className="gm-picker-grid" aria-label="First-party widgets">
        {entries.map((entry) => (
          <div key={entry.tag} className="gm-picker-card-wrap">
            <button type="button" className="gm-picker-card" onClick={() => onPlace(entry.widgetID)}>
              <span className="gm-picker-cn">
                {entry.name} <span className="gm-picker-badge gm-picker-badge--local">local</span>
              </span>
              <span className="gm-picker-cs">{entry.tag}</span>
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * One registered registry's catalog section: a search box wired to `query=` and
 * the fetched entries, each addable only if the boot admitted it.
 */
function RegistrySection({
  registryId,
  endpoint,
  onPlace,
}: {
  registryId: string;
  endpoint: string;
  onPlace: (widgetID: WidgetID) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [entries, setEntries] = useState<readonly RegistryWidgetEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Re-read the admitted set whenever the boot generation changes (a remote may be
  // admitted after this picker opens). The admitted set is the gated + verified
  // remotes; addability is membership in it — never a catalog-only decision.
  const generation = useFederatedGeneration();
  const admitted = generation >= 0 ? (federatedHost()?.remotes() ?? []) : [];

  // Debounce the search box before it drives a request.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        const list = await fetchRegistryWidgets(
          endpoint,
          debounced === '' ? {} : { query: debounced },
          { signal: controller.signal },
        );
        if (active) setEntries(list.widgets);
      } catch (cause) {
        if (active) {
          setError(cause instanceof RegistryCatalogError ? cause.message : String(cause));
          setEntries([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint, debounced]);

  return (
    <>
      <div className="gm-picker-section">Registry · {registryId}</div>
      <div className="gm-picker-search">
        <input
          type="search"
          placeholder="Search this registry's widgets…"
          aria-label={`Search ${registryId} widgets`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error !== undefined ? (
        <p className="gm-picker-error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="gm-picker-empty">Loading catalog…</p>
      ) : entries.length === 0 ? (
        <p className="gm-picker-empty">No widgets match in this registry.</p>
      ) : (
        <div className="gm-picker-grid" aria-label={`${registryId} catalog`}>
          {entries.map((entry) => {
            const { addable, widgetID } = resolveCatalogAddability(entry, admitted);
            return (
              <div key={`${entry.publisher}/${entry.tag}`} className="gm-picker-card-wrap">
                <button
                  type="button"
                  className="gm-picker-card"
                  disabled={!addable}
                  aria-disabled={!addable}
                  onClick={addable && widgetID !== undefined ? () => onPlace(widgetID) : undefined}
                >
                  <span className="gm-picker-cn">
                    {entry.name}
                    <span className="gm-picker-badge gm-picker-badge--registry">{registryId}</span>
                  </span>
                  <span className="gm-picker-cs">
                    {entry.publisher} · {entry.tag} · <span className="gm-picker-ver">v{entry.latestVersion}</span>
                  </span>
                  {entry.description !== undefined ? (
                    <span className="gm-picker-cd">{entry.description}</span>
                  ) : null}
                  {entry.capabilities.length > 0 ? (
                    <span className="gm-picker-caps">
                      {entry.capabilities.map((cap) => (
                        <span key={capabilityLabel(cap)} className="gm-picker-cap">
                          {capabilityLabel(cap)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {!addable ? (
                    <span className="gm-picker-note">Not enabled in this deployment.</span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * The **owner-acknowledged** sideload section (SPEC §4, FR-8) — prod-safe:
 * acknowledged mode ships in production builds. Persisted, URL-registered,
 * hash-pinned remotes with the distinct `acknowledged` badge; placing one verifies
 * the pinned hash before the module runs.
 */
function AcknowledgedSection({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { enabled, remotes, register, remove, loadModule, notePlacement } = useAcknowledgedSideload();
  const { addWidget } = useEditSession();
  const [url, setUrl] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function onRegister(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (url.trim() === '' || !acknowledged) return;
    setError(undefined);
    setBusy(true);
    try {
      await register(url.trim());
      setUrl('');
      setAcknowledged(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function place(remote: AcknowledgedRemote): Promise<void> {
    setError(undefined);
    setBusy(true);
    try {
      // Verify the pinned hash + define the element before placing — a mismatch
      // throws here and the widget is never added (FR-8).
      await loadModule(remote);
      const created = addWidget({ widgetID: remote.widgetID });
      if (created !== undefined) notePlacement(created.i, remote.widgetID);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <>
        <div className="gm-picker-section">Sideloaded · owner-acknowledged</div>
        <p className="gm-picker-empty">
          Acknowledged sideload is off (the default). No acknowledged remote loads until the deploy
          sets its sideload mode to <code>acknowledged</code>.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="gm-picker-section">Sideloaded · owner-acknowledged</div>
      <form className="gm-picker-register" onSubmit={onRegister}>
        <input
          type="url"
          placeholder="acknowledged remote URL, e.g. https://widgets.example.com"
          aria-label="Acknowledged remote URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          type="submit"
          className="gm-picker-btn gm-picker-btn-primary"
          disabled={busy || url.trim() === '' || !acknowledged}
        >
          Acknowledge remote
        </button>
      </form>
      <label className="gm-picker-ackline">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          aria-label="Acknowledge unreviewed code"
        />
        <span>
          I acknowledge this is <b>unreviewed</b> code: {SIDELOAD_NO_VERIFY_CAVEAT}.
        </span>
      </label>

      {error !== undefined ? (
        <p className="gm-picker-error" role="alert">
          {error}
        </p>
      ) : null}

      {remotes.length === 0 ? (
        <p className="gm-picker-empty">No acknowledged remotes registered. Register a remote URL above.</p>
      ) : (
        <div className="gm-picker-grid" aria-label="Acknowledged remotes">
          {remotes.map((remote) => (
            <div key={remote.url} className="gm-picker-card-wrap">
              <button type="button" className="gm-picker-card" disabled={busy} onClick={() => void place(remote)}>
                <span className="gm-picker-cn">
                  {remote.name}{' '}
                  <span className="gm-picker-badge">{ACKNOWLEDGED_BADGE_LABEL}</span>
                </span>
                <span className="gm-picker-cs">sideload · {remote.origin}</span>
                <span className="gm-picker-cd">
                  Unreviewed. Loaded because the deploy owner acknowledged this origin.
                </span>
              </button>
              <button type="button" className="gm-picker-card-remove" onClick={() => void remove(remote.url)}>
                remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** The registered registries to browse, derived from the deployment's federated config. */
function useRegistries(): readonly { registryId: string; endpoint: string }[] {
  const config = useFederatedConfig();
  if (config === null) return [];
  try {
    return [{ registryId: config.gate.registry, endpoint: widgetsEndpointFor(config.resolveEndpoint) }];
  } catch {
    return [];
  }
}

export function AddWidgetPicker({ page, onClose }: { page: PageRef; onClose: () => void }): React.JSX.Element {
  const { addWidget } = useEditSession();
  const registries = useRegistries();
  const sheetRef = useRef<HTMLDivElement>(null);

  // Place a widget by identity, then close (the single insert path all sections use).
  const place = useCallback(
    (widgetID: WidgetID) => {
      addWidget({ widgetID });
      onClose();
    },
    [addWidget, onClose],
  );

  // Focus the dialog on open and close it on Escape (keyboard/ARIA correctness).
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  return (
    <div
      className="gm-picker-scrim"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="gm-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Add widget"
        tabIndex={-1}
      >
        <div className="gm-picker-head">
          <h2>Add widget</h2>
          <span className="gm-picker-ctx">
            page <b>{page.pageType}</b> · context: <b>{contextLabel(page.pageType)}</b>
          </span>
          <div className="gm-picker-spacer" />
          <button type="button" className="gm-picker-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="gm-picker-body">
          <LocalSection onPlace={place} />

          {registries.map((registry) => (
            <RegistrySection
              key={registry.registryId}
              registryId={registry.registryId}
              endpoint={registry.endpoint}
              onPlace={place}
            />
          ))}

          <AcknowledgedSection onClose={onClose} />

          {/* Dev-sideload (SPEC §4, FR-7): development builds only — referenced under
              `import.meta.env.DEV` so a production build drops the whole dev subtree
              (`../sideload/production-gate.test.ts`). */}
          {import.meta.env.DEV ? <DevSideloadSection page={page} onClose={onClose} /> : null}
        </div>
      </div>
    </div>
  );
}
