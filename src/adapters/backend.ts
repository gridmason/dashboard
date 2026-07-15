/**
 * The **session backend** composition seam. The dashboard talks to its data
 * through three adapters — a session bootstrap, a layout persistence adapter, and
 * a governance adapter (docs/SPEC.md §5/§6). There are two implementations of
 * each: the **API-backed** reference set (talks to the demo API over HTTP) and the
 * **static-demo** set (browser-only: a fixed baked user + `localStorage` stores).
 *
 * This module is the one place that chooses between them, so the edit session
 * (`../edit/edit-session`) constructs its backend the same way regardless of build
 * target. The choice is the build-time flag `__GM_STATIC_DEMO__`, injected as a
 * Vite `define` from `GRIDMASON_STATIC_DEMO` (see `vite.config.ts`): a value of
 * `true` selects the static set, otherwise the API set. Because the flag is a
 * literal at build time, the unused set is tree-shaken out — the static-demo
 * bundle carries no `fetch`-based adapter (and thus makes no demo-API calls), and
 * the server-backed bundle carries no `localStorage` adapter.
 */
import { ensureSession, type SessionUser } from './session/session-client';
import { ensureStaticSession } from './session/static-session';
import {
  ApiLayoutPersistence,
  LocalLayoutPersistence,
  type LayoutPersistenceAdapter,
} from './persistence';
import { ApiGovernance, LocalGovernance, type GovernanceAdapter } from './governance';

/**
 * Base URL the demo API is reached at in the server-backed build. Empty means
 * same-origin: dev and preview proxy `/api` to the demo API (see `vite.config.ts`),
 * so the ambient `HttpOnly` session cookie authenticates every call.
 */
const DEMO_API_BASE = '';

/**
 * Whether this build is the static-demo (serverless) target. Reads the build-time
 * `__GM_STATIC_DEMO__` define through a `typeof` guard so it is safe under Vitest
 * (where the define is absent) — an unset value is the server-backed default.
 */
export function isStaticDemo(): boolean {
  return typeof __GM_STATIC_DEMO__ !== 'undefined' && __GM_STATIC_DEMO__ === true;
}

/** The data backend for one edit session: how it signs in and where layouts/org publications live. */
export interface SessionBackend {
  /** Sign in (resolve the current session user). */
  ensureSession(): Promise<SessionUser>;
  /** The layout persistence adapter for `userId` (user override store). */
  createLayoutPersistence(userId: string): LayoutPersistenceAdapter;
  /** The governance adapter for `userId` (org publication store). */
  createGovernance(userId: string): GovernanceAdapter;
}

/** The API-backed reference backend (talks to the demo API over HTTP). */
function apiBackend(): SessionBackend {
  return {
    ensureSession: () => ensureSession(DEMO_API_BASE),
    createLayoutPersistence: (userId) =>
      new ApiLayoutPersistence({ userId, baseUrl: DEMO_API_BASE }),
    createGovernance: (userId) => new ApiGovernance({ userId, baseUrl: DEMO_API_BASE }),
  };
}

/** The static-demo backend (fixed baked user + `localStorage` stores, no network). */
function staticBackend(): SessionBackend {
  return {
    ensureSession: () => ensureStaticSession(),
    createLayoutPersistence: (userId) => new LocalLayoutPersistence({ userId }),
    createGovernance: (userId) => new LocalGovernance({ userId }),
  };
}

/** The backend for this build target: static-demo when {@link isStaticDemo}, else API-backed. */
export function sessionBackend(): SessionBackend {
  return isStaticDemo() ? staticBackend() : apiBackend();
}
