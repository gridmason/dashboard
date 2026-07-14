/**
 * The four demo page types, as **data** (docs/SPEC.md §5, FR-2).
 *
 * A page type is a descriptor — a typed context, a default layout, its locked
 * slots, and whether users may customize it — *not* a component. There is no
 * per-page-type React code and, deliberately, no bespoke module for any one of
 * them (the "no special-case pages" invariant, SPEC §1–2): every route renders
 * the same `PageCanvas` host, and a page type is looked up here by id. That is
 * what `demo.full-canvas` exists to prove — a single full-bleed widget is just
 * another entry in this table, not a hand-written full-screen page.
 *
 * Each descriptor is registered into the engine's {@link PageTypeRegistry}, so
 * its typed context is validated against the protocol context grammar at module
 * load (a malformed page type fails loudly here, not at mount). The default
 * layout doc for each lives alongside its descriptor; the canvas glue composes
 * it into an `EffectiveLayout` via `resolveLayout`, passing the descriptor's
 * `locks` as the default level's locks.
 *
 * Every layout references the Phase-A placeholder widget (`../boot/import-map`);
 * #6 swaps in the first-party demo widgets and the layouts that showcase them.
 */

import {
  CURRENT_LAYOUT_SCHEMA_VERSION,
  PageTypeRegistry,
  type RegisteredPageType,
} from '@gridmason/core/engine';
import type { LayoutPage, LayoutWidget } from '@gridmason/protocol';
import { DEFAULT_PAGE_TYPE } from '../routes';
import { LOCAL_SOURCE, PLACEHOLDER_WIDGET_TAG } from '../boot/import-map';

/** A demo page type: its registered descriptor plus the default layout it ships. */
export interface DemoPageType {
  /** Validated, normalized page-type descriptor (context, locks, customization). */
  readonly descriptor: RegisteredPageType;
  /** The default layout rendered for a fresh instance of this page type. */
  readonly defaultLayout: LayoutPage;
}

/** A placed placeholder widget — every demo item is one, distinguished by its `label` prop. */
function placeholder(
  item: Omit<LayoutWidget, 'widgetID'> & { readonly label: string },
): LayoutWidget {
  const { label, props, slot, ...geometry } = item;
  return {
    widgetID: { source: LOCAL_SOURCE, tag: PLACEHOLDER_WIDGET_TAG },
    ...geometry,
    props: { label, ...props },
    ...(slot !== undefined ? { slot } : {}),
  };
}

/** Wrap a set of placed items into a single-grid default {@link LayoutPage}. */
function defaultLayout(page: string, name: string, items: readonly LayoutWidget[]): LayoutPage {
  return {
    schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
    page,
    name,
    default: true,
    grid: { items },
    hasTabs: false,
    tabs: [],
  };
}

/**
 * The registration input for one page type: the descriptor fields the engine
 * validates plus the default layout doc kept beside it. Assembled here so the
 * two never drift (the layout's `page` must be the descriptor's `id`).
 */
interface DemoPageTypeInput {
  readonly id: string;
  readonly context: RegisteredPageType['context'];
  readonly locks?: readonly string[];
  readonly allow_user_customization?: boolean;
  readonly layoutName: string;
  readonly items: readonly LayoutWidget[];
}

/**
 * The four demo page types (SPEC §5):
 *
 * - `dashboards.home` — a free canvas grid: no typed context, no locks, users
 *   customize freely.
 * - `demo.record-detail` — a typed `record-ref` context (a `customer` record)
 *   with a **locked header slot** pinned above a customizable body.
 * - `demo.locked` — a fully locked page: `allow_user_customization: false` and
 *   every slot locked, so nothing moves.
 * - `demo.full-canvas` — one maximized, locked widget spanning the grid. An
 *   ordinary page type, not special-cased — the no-special-case proof.
 */
const DEMO_PAGE_TYPES: readonly DemoPageTypeInput[] = [
  {
    id: 'dashboards.home',
    context: {},
    allow_user_customization: true,
    layoutName: 'Home dashboard',
    items: [
      placeholder({ i: 'clock', x: 0, y: 0, w: 3, h: 2, label: 'Clock' }),
      placeholder({ i: 'notes', x: 3, y: 0, w: 5, h: 2, label: 'Notes' }),
      placeholder({ i: 'chart', x: 8, y: 0, w: 4, h: 3, label: 'Chart' }),
      placeholder({ i: 'activity', x: 0, y: 2, w: 8, h: 3, label: 'Activity feed' }),
    ],
  },
  {
    id: 'demo.record-detail',
    context: { record: { type: 'record-ref', recordType: 'customer' } },
    locks: ['header'],
    allow_user_customization: true,
    layoutName: 'Record detail',
    items: [
      placeholder({ i: 'header', slot: 'header', x: 0, y: 0, w: 12, h: 2, label: 'Customer header' }),
      placeholder({ i: 'summary', x: 0, y: 2, w: 6, h: 3, label: 'Record summary' }),
      placeholder({ i: 'metrics', x: 6, y: 2, w: 6, h: 3, label: 'Metrics' }),
    ],
  },
  {
    id: 'demo.locked',
    context: {},
    locks: ['summary', 'activity', 'notes'],
    allow_user_customization: false,
    layoutName: 'Locked page',
    items: [
      placeholder({ i: 'summary', slot: 'summary', x: 0, y: 0, w: 6, h: 3, label: 'Overview' }),
      placeholder({ i: 'activity', slot: 'activity', x: 6, y: 0, w: 6, h: 3, label: 'Activity' }),
      placeholder({ i: 'notes', slot: 'notes', x: 0, y: 3, w: 12, h: 2, label: 'Notes' }),
    ],
  },
  {
    id: 'demo.full-canvas',
    context: {},
    locks: ['main'],
    allow_user_customization: false,
    layoutName: 'Full canvas',
    items: [
      placeholder({ i: 'main', slot: 'main', x: 0, y: 0, w: 12, h: 8, label: 'Full-canvas widget' }),
    ],
  },
];

/** The engine page-type registry, populated once at module load. */
const registry = new PageTypeRegistry();

/** page-type id → its descriptor + default layout, built by registering each input. */
const pageTypes = new Map<string, DemoPageType>(
  DEMO_PAGE_TYPES.map((input) => {
    const descriptor = registry.register({
      id: input.id,
      context: input.context,
      default_layout: input.layoutName,
      ...(input.locks !== undefined ? { locks: input.locks } : {}),
      ...(input.allow_user_customization !== undefined
        ? { allow_user_customization: input.allow_user_customization }
        : {}),
    });
    return [input.id, { descriptor, defaultLayout: defaultLayout(input.id, input.layoutName, input.items) }];
  }),
);

/** The demo page type for `id`, or `undefined` if none is registered. */
export function getPageType(id: string): DemoPageType | undefined {
  return pageTypes.get(id);
}

/**
 * Resolve a page-type id to its demo page type, falling back to the default page
 * type ({@link DEFAULT_PAGE_TYPE}) for an unknown id so a route always renders a
 * canvas rather than dead-ending (mirrors the router's catch-all).
 */
export function resolvePageType(id: string): DemoPageType {
  return pageTypes.get(id) ?? pageTypes.get(DEFAULT_PAGE_TYPE)!;
}

/** All demo page types, in declaration order (for tests and any future picker). */
export function listPageTypes(): readonly DemoPageType[] {
  return [...pageTypes.values()];
}
