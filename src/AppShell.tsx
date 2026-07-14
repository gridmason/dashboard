import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PageRef } from './routes';
import { resolvePageType } from './pages/page-types';
import { useEditSession } from './edit/edit-session';
import { DevSideloadControls } from './sideload';
import './AppShell.css';

/**
 * A short label for the typed context a page provides (SPEC §5), read from its
 * page-type descriptor: the declared context-slot types, or `none` for a page
 * that provides no context. Reflects what the canvas actually hands widgets,
 * rather than inferring context from the presence of an entity id.
 */
function contextLabel(pageType: string): string {
  const types = Object.values(resolvePageType(pageType).descriptor.context).map((t) => t.type);
  return types.length > 0 ? [...new Set(types)].join(', ') : 'none';
}

const BrandMark = (): React.JSX.Element => (
  <svg viewBox="0 0 128 128" width="26" height="26" aria-hidden="true">
    <rect x="34" y="34" width="30" height="30" rx="6" fill="#C9762B" />
    <rect x="34" y="70" width="30" height="30" rx="6" fill="#A85A1F" />
    <rect x="70" y="70" width="30" height="30" rx="6" fill="#C9762B" />
    <rect x="76" y="20" width="30" height="30" rx="6" fill="#E3A857" transform="rotate(8 91 35)" />
  </svg>
);

/** Flip the forced theme; absence of `data-theme` means "follow the OS". */
function toggleTheme(): 'light' | 'dark' {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = root.getAttribute('data-theme');
  const isDark = current === 'dark' || (current === null && prefersDark);
  const next = isDark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  return next;
}

/**
 * Minimal, product-neutral chrome around the page canvas. Deliberately thin —
 * the dashboard is a showcase, not a product shell — and styled only through the
 * theme tokens so a host re-themes it by overriding custom properties.
 */
export function AppShell({
  page,
  children,
}: {
  page: PageRef;
  children: ReactNode;
}): React.JSX.Element {
  const [, setTheme] = useState<'light' | 'dark' | null>(null);
  const { ready, canEdit, editing, dirty, enter, save, discard, resetToDefault } = useEditSession();

  return (
    <div className="gm-shell">
      <header className="gm-topbar">
        <div className="gm-brand">
          <BrandMark />
          grid<span>mason</span>
        </div>
        {editing ? <span className="gm-editflag">● Editing layout</span> : null}
        <span className="gm-crumb">
          page&nbsp;·&nbsp;<b>{page.pageType}</b>
          {page.entityId !== undefined ? <> · {page.entityId}</> : null}
        </span>
        <span className="gm-pill">context: {contextLabel(page.pageType)}</span>
        <div className="gm-spacer" />
        {/* Edit toolbar (mockup 02-edit-mode.html). Save/Discard commit or drop the
            staged edit; Reset deletes the user override so the page falls back to
            the org/default layout. Hidden entirely on a page that forbids customization. */}
        {editing ? (
          <>
            {/* Dev-sideload author loop (SPEC §4): the Add-widget picker for
                `gridmason dev` remotes. Development builds only — dead code, and
                so dropped, in a production build (`import.meta.env.DEV`). */}
            {import.meta.env.DEV ? <DevSideloadControls page={page} /> : null}
            <button
              type="button"
              className="gm-btn"
              onClick={() => void discard()}
              disabled={!dirty}
            >
              Discard
            </button>
            <button type="button" className="gm-btn" onClick={() => void resetToDefault()}>
              Reset to org default
            </button>
            <button
              type="button"
              className="gm-btn gm-btn-primary"
              onClick={() => void save()}
              disabled={!dirty}
            >
              Save layout
            </button>
          </>
        ) : ready && canEdit ? (
          <button type="button" className="gm-btn" onClick={enter}>
            Edit layout
          </button>
        ) : null}
        <button
          type="button"
          className="gm-themebtn"
          aria-label="Toggle colour theme"
          onClick={() => setTheme(toggleTheme())}
        >
          ☀ / ☾
        </button>
      </header>
      <main className="gm-main">{children}</main>
    </div>
  );
}
