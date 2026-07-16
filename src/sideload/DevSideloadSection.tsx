/**
 * The **dev-sideload** section of the Add Widget picker (docs/SPEC.md §4, FR-7) —
 * **development builds only**. Extracted from the former dev-only picker so the
 * reworked, prod-safe picker (`../edit/AddWidgetPicker`) can host it as a section
 * without pulling dev code into production: the picker references this component
 * only under `import.meta.env.DEV`, a static `false` in a production build, so Vite
 * dead-code-eliminates this whole subtree (proven by `production-gate.test.ts`).
 *
 * Behavior is unchanged from the old picker: an owner-acknowledgement gate unlocks a
 * register-dev-origin form and a list of admitted `gridmason dev` remotes; placing
 * one hot-loads it through the same governed {@link EditSession.addWidget} path a
 * first-party widget takes. It reuses the picker's `gm-picker-*` layout classes (the
 * picker's stylesheet is present in dev too) and the dev-only `gm-sideload-badge`.
 */
import { useState } from 'react';
import type { PageRef } from '../routes';
import { useEditSession } from '../edit/edit-session';
import { useDevSideload } from './DevSideloadContext';
import { SIDELOAD_BADGE_LABEL } from './source';
import { SIDELOAD_NO_VERIFY_CAVEAT } from './policy';
import type { DevSideloadRemote } from './allowlist-store';

/** The amber `sideload` badge shown on every dev-sideload picker entry (mockup 03). */
function SideloadBadge(): React.JSX.Element {
  return <span className="gm-sideload-badge">{SIDELOAD_BADGE_LABEL}</span>;
}

export function DevSideloadSection({ onClose }: { page: PageRef; onClose: () => void }): React.JSX.Element {
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
    <div className="gm-devsl">
      <div className="gm-picker-section">Sideloaded · dev server</div>
      {!acknowledged ? (
        // Owner acknowledgement (SPEC §4): dev sideload is unlocked only by an
        // explicit, disclaimed acceptance — and the Phase-A honesty rule (FR-8):
        // there is no verification chain yet.
        <div className="gm-picker-ack">
          <b>Dev sideload — unreviewed code.</b> Widgets loaded from a{' '}
          <code>gridmason dev</code> server bypass registry review: {SIDELOAD_NO_VERIFY_CAVEAT}.
          Nothing here is persisted — it is gone on reload.
          <div>
            <button
              type="button"
              className="gm-picker-btn gm-picker-btn-primary gm-picker-ackbtn"
              onClick={acknowledge}
            >
              I understand — enable dev sideload
            </button>
          </div>
        </div>
      ) : (
        <>
          <form className="gm-picker-register" onSubmit={onRegister}>
            <input
              type="url"
              placeholder="gridmason dev origin, e.g. http://localhost:6070"
              aria-label="Dev server origin"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            />
            <button
              type="submit"
              className="gm-picker-btn gm-picker-btn-primary"
              disabled={busy || origin.trim() === ''}
            >
              Register
            </button>
          </form>

          {error !== undefined ? (
            <p className="gm-picker-error" role="alert">
              {error}
            </p>
          ) : null}

          {remotes.length === 0 ? (
            <p className="gm-picker-empty">
              No dev remotes admitted this session. Run <code>gridmason dev</code> and register its
              origin above.
            </p>
          ) : (
            <div className="gm-picker-grid" aria-label="Admitted dev remotes">
              {remotes.map((remote) => (
                // Card and remove are sibling controls, not nested — a button may not
                // contain another interactive control.
                <div key={remote.origin} className="gm-picker-card-wrap">
                  <button
                    type="button"
                    className="gm-picker-card"
                    disabled={busy}
                    onClick={() => void place(remote)}
                  >
                    <span className="gm-picker-cn">
                      {remote.name} <SideloadBadge />
                    </span>
                    <span className="gm-picker-cs">sideload · {remote.origin}</span>
                    <span className="gm-picker-cd">
                      Unreviewed. Loaded because you registered this dev origin.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="gm-picker-card-remove"
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
  );
}
