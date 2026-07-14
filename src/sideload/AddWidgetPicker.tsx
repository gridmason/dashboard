/**
 * The dev add-widget picker (docs/SPEC.md §4 + §6; mockup 03-add-widget-picker.html)
 * — **development builds only**.
 *
 * D-E1 shipped no add-widget picker, so this builds the **minimal picker surface
 * the sideload flow needs** (issue #11 scope note): a modal that lists the
 * admitted dev-server remotes as entries — each with the distinct `sideload`
 * badge (mockup 03 `.tag.side`) — and, on selection, hot-loads the remote onto
 * the current governed page through the same {@link EditSession.addWidget} path a
 * first-party widget would use. The general first-party registry picker (all four
 * gating checks over a catalog) is a later surface; this one is scoped to the dev
 * loop. Registration of a dev-server origin lives here too, behind the owner
 * acknowledgement, so the whole author loop is one sheet.
 */
import { useState } from 'react';
import { resolvePageType } from '../pages/page-types';
import { useEditSession } from '../edit/edit-session';
import type { PageRef } from '../routes';
import { useDevSideload } from './DevSideloadContext';
import { SIDELOAD_BADGE_LABEL } from './source';
import type { DevSideloadRemote } from './allowlist-store';

function contextLabel(pageType: string): string {
  const types = Object.values(resolvePageType(pageType).descriptor.context).map((t) => t.type);
  return types.length > 0 ? [...new Set(types)].join(', ') : 'none';
}

/** The amber `sideload` badge shown on every dev-sideload card + picker entry. */
function SideloadBadge(): React.JSX.Element {
  return <span className="gm-sideload-badge">{SIDELOAD_BADGE_LABEL}</span>;
}

export function AddWidgetPicker({
  page,
  onClose,
}: {
  page: PageRef;
  onClose: () => void;
}): React.JSX.Element {
  const { acknowledged, remotes, acknowledge, register, remove, loadModule, notePlacement } =
    useDevSideload();
  const { addWidget } = useEditSession();
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function onRegister(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (origin.trim() === '') return;
    setError(undefined);
    setBusy(true);
    try {
      await register(origin.trim());
      setOrigin('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function place(remote: DevSideloadRemote): Promise<void> {
    setError(undefined);
    setBusy(true);
    try {
      // Define the custom element from the dev server first, then place it — so the
      // canvas mounts an upgraded element rather than falling it to an error card.
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

  return (
    <div
      className="gm-sl-scrim"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="gm-sl-sheet" role="dialog" aria-modal="true" aria-label="Add widget">
        <div className="gm-sl-head">
          <h2>Add widget</h2>
          <span className="gm-sl-ctx">
            page <b>{page.pageType}</b> · context: <b>{contextLabel(page.pageType)}</b>
          </span>
          <div className="gm-sl-spacer" />
          <button type="button" className="gm-sl-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="gm-sl-body">
          {!acknowledged ? (
            // Owner acknowledgement (SPEC §4): dev sideload is unlocked only by an
            // explicit, disclaimed acceptance — and the Phase-A honesty rule (FR-8):
            // there is no verification chain yet.
            <div className="gm-sl-ack">
              <b>Dev sideload — unreviewed code.</b> Widgets loaded from a{' '}
              <code>gridmason dev</code> server bypass registry review, and Gridmason has{' '}
              <b>no verification chain yet</b>. Only enable this for widgets you built or
              reviewed yourself. Nothing here is persisted — it is gone on reload.
              <div>
                <button
                  type="button"
                  className="gm-sl-btn gm-sl-btn-primary gm-sl-ackbtn"
                  onClick={acknowledge}
                >
                  I understand — enable dev sideload
                </button>
              </div>
            </div>
          ) : (
            <>
              <form className="gm-sl-register" onSubmit={onRegister}>
                <input
                  type="url"
                  placeholder="gridmason dev origin, e.g. http://localhost:6070"
                  aria-label="Dev server origin"
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                />
                <button
                  type="submit"
                  className="gm-sl-btn gm-sl-btn-primary"
                  disabled={busy || origin.trim() === ''}
                >
                  Register
                </button>
              </form>

              {error !== undefined ? (
                <p className="gm-sl-error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="gm-sl-divider">Sideloaded · dev server</div>

              {remotes.length === 0 ? (
                <p className="gm-sl-empty">
                  No dev remotes admitted this session. Run <code>gridmason dev</code> and register
                  its origin above.
                </p>
              ) : (
                <div className="gm-sl-grid" aria-label="Admitted dev remotes">
                  {remotes.map((remote) => (
                    // Card and remove are sibling controls, not nested — a button
                    // may not contain another interactive control.
                    <div key={remote.origin} className="gm-sl-card-wrap">
                      <button
                        type="button"
                        className="gm-sl-card"
                        disabled={busy}
                        onClick={() => void place(remote)}
                      >
                        <span className="gm-sl-cn">
                          {remote.name} <SideloadBadge />
                        </span>
                        <span className="gm-sl-cs">sideload · {remote.origin}</span>
                        <span className="gm-sl-cd">
                          Unreviewed. Loaded because you registered this dev origin.
                        </span>
                      </button>
                      <button
                        type="button"
                        className="gm-sl-card-remove"
                        onClick={() => remove(remote.origin)}
                      >
                        remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
