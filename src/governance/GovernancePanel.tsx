/**
 * The governance panel (FR-4, SPEC §5): the operator control + the three-level
 * resolution view from mockup 04-governance.html. It reads everything from the
 * {@link useEditSession} — the page-type default, the org publication, and the
 * effective (resolved) layout — and renders them as three schematic mini-grids so
 * a viewer can watch "most-specific wins, locked slots merge down" resolve.
 *
 * The panel owns only the *operator* half (publish / un-publish, gated on the
 * role stub). The *user* half — override an unlocked slot, then reset — is the
 * ordinary edit toolbar the shell already renders; this panel just makes the
 * result of those actions visible in the User column.
 */
import type { LayoutPage } from '@gridmason/protocol';
import { useEditSession } from '../edit/edit-session';
import { resolvePageType } from '../pages/page-types';
import { GOVERNED_PAGE, ORG_PUBLICATION } from './org-publication';
import './governance.css';

/** The default-level locks the governed page ships with (its page-type descriptor). */
const DEFAULT_LOCKS = resolvePageType(GOVERNED_PAGE.pageType).descriptor.locks;

/** A human label for a placed item — its slot role, else its instance id. */
function itemLabel(item: LayoutPage['grid']['items'][number]): string {
  return item.slot ?? item.i;
}

/** Mini-grid column span for an item, mapping a 12-col layout onto the 6-col schematic. */
function span(width: number): number {
  return Math.min(6, Math.max(1, Math.round(width / 2)));
}

/**
 * One resolution level rendered as a schematic mini-grid. A tile is badged 🔒 when
 * its slot is locked at or above this level (`lockedSlots`); an absent layout
 * renders the level's empty state (e.g. no org layout published yet).
 */
function LevelCard({
  step,
  title,
  note,
  layout,
  lockedSlots,
  active = false,
  empty,
}: {
  step: number;
  title: string;
  note: string;
  layout: LayoutPage | undefined;
  lockedSlots: readonly string[];
  active?: boolean;
  empty?: string;
}): React.JSX.Element {
  const locks = new Set(lockedSlots);
  return (
    <div className={`gm-lvl${active ? ' gm-lvl-active' : ''}`}>
      <h3>
        <span className="gm-lvl-step">{step}</span>
        {title}
      </h3>
      {layout === undefined ? (
        <div className="gm-lvl-empty">{empty}</div>
      ) : (
        <div className="gm-lvl-grid">
          {layout.grid.items.map((item) => {
            const locked = item.slot !== undefined && locks.has(item.slot);
            return (
              <div
                key={item.i}
                className={`gm-tile${locked ? ' gm-tile-lock' : ''}`}
                style={{ gridColumn: `span ${span(item.w)}` }}
                data-slot={item.slot ?? item.i}
                data-locked={locked ? 'true' : 'false'}
              >
                {itemLabel(item)}
              </div>
            );
          })}
        </div>
      )}
      <p className="gm-lvl-cap">{note}</p>
    </div>
  );
}

/** The operator control + the three-level resolution view. */
export function GovernancePanel(): React.JSX.Element {
  const { ready, defaultLayout, orgPublication, effective, canPublish, publish, unpublish } =
    useEditSession();

  const published = orgPublication !== undefined;
  const orgLocks = orgPublication?.locks ?? [];
  const effectiveLocks = effective?.lockedSlots ?? [];

  return (
    <section className="gm-gov">
      <header className="gm-gov-head">
        <h1>Layout governance — resolution made visible</h1>
        <p className="gm-gov-sub">
          page <span className="gm-mono">{GOVERNED_PAGE.pageType}</span> · one effective layout,
          resolved most-specific-wins
        </p>
      </header>

      <div className="gm-gov-flow">
        plugin/host default → organization layout → user personal layout → <b>effective</b>
      </div>

      <div className="gm-gov-ops" aria-live="polite">
        <span className="gm-gov-state">
          {published ? (
            <>
              <b>Org layout published.</b> The org standard governs this page — the{' '}
              <span className="gm-mono">header</span> and <span className="gm-mono">metrics</span>{' '}
              slots are locked; users may still rearrange <span className="gm-mono">notes</span>.
            </>
          ) : (
            <>
              <b>No org layout published.</b> The page shows the plugin default — only its{' '}
              <span className="gm-mono">header</span> slot is locked.
            </>
          )}
        </span>
        <span className="gm-gov-ops-actions">
          {published ? (
            <button
              type="button"
              className="gm-btn"
              disabled={!ready || !canPublish}
              onClick={() => void unpublish()}
            >
              Unpublish org layout
            </button>
          ) : (
            <button
              type="button"
              className="gm-btn gm-btn-primary"
              disabled={!ready || !canPublish}
              onClick={() => void publish(ORG_PUBLICATION)}
            >
              Publish org layout with locks
            </button>
          )}
        </span>
        {!canPublish ? (
          <span className="gm-gov-rolenote">Sign in as an operator (admin role) to publish.</span>
        ) : null}
      </div>

      <section className="gm-gov-lane" aria-label="Three-level layout resolution">
        <LevelCard
          step={1}
          title="Plugin default"
          note="The layout that ships with the page type. Only the header slot is locked by the page-type descriptor."
          layout={defaultLayout}
          lockedSlots={DEFAULT_LOCKS}
        />
        <LevelCard
          step={2}
          title="Org layout"
          note="The organization's published standard. It re-arranges the body and adds a lock on the metrics slot — locks merge down and can't be overridden below here."
          layout={orgPublication?.layout}
          lockedSlots={[...DEFAULT_LOCKS, ...orgLocks]}
          empty="Not published — resolution falls through to the plugin default."
        />
        <LevelCard
          step={3}
          title="User layout"
          note="The effective layout this user sees — copy-on-write from the org layout on first edit. The locked header and metrics slots stay put; notes is theirs to move."
          layout={effective?.layout}
          lockedSlots={effectiveLocks}
          active
        />
      </section>

      <div className="gm-gov-rules">
        <div className="gm-gov-rule">
          <b>Most-specific wins.</b> User overrides org overrides plugin, per slot —{' '}
          <span className="gm-mono">resolveLayout</span> is a pure function in{' '}
          <span className="gm-mono">@gridmason/core</span>. Every tile above is derived.
        </div>
        <div className="gm-gov-rule">
          <b>Locks are one-directional.</b> A slot locked at the org level can't be moved or
          unlocked by the user. Reset-to-org-default is on the edit toolbar.
        </div>
      </div>
    </section>
  );
}
