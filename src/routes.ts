/**
 * The route model (FR-1, SPEC §1–2).
 *
 * Gridmason has no special-case page components. A route's *only* job is to
 * resolve a {@link PageRef} — a page type and an optional entity id — which is
 * then handed to the one generic canvas host. New page types (D-E1) and typed
 * `record-ref` contexts (SPEC §5) slot in here without adding page components.
 */

/** The resolved identity of a page: a page type plus an optional entity scope. */
export interface PageRef {
  /** Page-type identity the canvas resolves its layout from (SPEC §5). */
  readonly pageType: string;
  /** Entity the page is scoped to, for typed-context page types (optional). */
  readonly entityId?: string;
}

/** Page type rendered at `/` when no page type is present in the URL. */
export const DEFAULT_PAGE_TYPE = 'dashboards.home';

/**
 * Route patterns, in match order. Every pattern resolves to a {@link PageRef}
 * and renders the same canvas host — see {@link resolvePageRef}.
 */
export const ROUTES = {
  home: '/',
  page: '/p/:pageType',
  pageEntity: '/p/:pageType/:entityId',
  /** The governance demo (FR-4): a single governed page with the 3-level resolution view. */
  governance: '/governance',
} as const;

/** Build the path for a page ref (used by links/navigation). */
export function pathForPage(ref: PageRef): string {
  if (ref.pageType === DEFAULT_PAGE_TYPE && ref.entityId === undefined) {
    return ROUTES.home;
  }
  const base = `/p/${encodeURIComponent(ref.pageType)}`;
  return ref.entityId === undefined
    ? base
    : `${base}/${encodeURIComponent(ref.entityId)}`;
}

/**
 * Normalize the raw route params (all optional strings from the matcher) into a
 * {@link PageRef}, applying the default page type. This is the single place a
 * URL becomes a page identity.
 */
export function resolvePageRef(params: {
  pageType?: string | undefined;
  entityId?: string | undefined;
}): PageRef {
  const pageType = params.pageType ?? DEFAULT_PAGE_TYPE;
  return params.entityId === undefined
    ? { pageType }
    : { pageType, entityId: params.entityId };
}
