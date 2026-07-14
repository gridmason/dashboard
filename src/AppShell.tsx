import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PageRef } from './routes';
import './AppShell.css';

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

  return (
    <div className="gm-shell">
      <header className="gm-topbar">
        <div className="gm-brand">
          <BrandMark />
          grid<span>mason</span>
        </div>
        <span className="gm-crumb">
          page&nbsp;·&nbsp;<b>{page.pageType}</b>
          {page.entityId !== undefined ? <> · {page.entityId}</> : null}
        </span>
        <span className="gm-pill">
          context: {page.entityId !== undefined ? 'record-ref' : 'none'}
        </span>
        <div className="gm-spacer" />
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
