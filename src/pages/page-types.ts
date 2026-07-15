/**
 * The five demo page types, as **data** (docs/SPEC.md §5, FR-2).
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
 * Every layout places the first-party demo widgets (`../boot/import-map`
 * `WIDGET_TAGS`) so the demo page types together showcase the whole widget ABI
 * (SPEC §5): static clock/markdown, the context-consuming record-summary, the
 * schema-validated chart, and the deliberate crasher that proves the per-widget
 * error boundary.
 */

import {
  CURRENT_LAYOUT_SCHEMA_VERSION,
  PageTypeRegistry,
  type RegisteredPageType,
} from '@gridmason/core/engine';
import type { LayoutPage, LayoutWidget } from '@gridmason/protocol';
import { DEFAULT_PAGE_TYPE } from '../routes';
import { LOCAL_SOURCE, WIDGET_TAGS } from '../boot/import-map';

/** A demo page type: its registered descriptor plus the default layout it ships. */
export interface DemoPageType {
  /** Validated, normalized page-type descriptor (context, locks, customization). */
  readonly descriptor: RegisteredPageType;
  /** The default layout rendered for a fresh instance of this page type. */
  readonly defaultLayout: LayoutPage;
}

/** A placed widget item, before its `local` source-qualified identity is attached. */
type PlacedWidget = Omit<LayoutWidget, 'widgetID'>;

/**
 * Place one first-party demo widget (`tag`) into a grid: attach its `local`
 * source-qualified identity to the geometry/props/slot. The demo widget tags
 * come from the import map (`WIDGET_TAGS`), so a placement and its registered
 * remote can never drift.
 */
function widget(tag: string, item: PlacedWidget): LayoutWidget {
  const { props, slot, ...geometry } = item;
  return {
    widgetID: { source: LOCAL_SOURCE, tag },
    ...geometry,
    ...(props !== undefined ? { props } : {}),
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
 * The five demo page types (SPEC §5):
 *
 * - `dashboards.home` — a free canvas grid: no typed context, no locks, users
 *   customize freely.
 * - `demo.record-detail` — a typed `record-ref` context (a `customer` record)
 *   with a **locked header slot** pinned above a customizable body.
 * - `demo.locked` — a fully locked page: `allow_user_customization: false` and
 *   every slot locked, so nothing moves.
 * - `demo.telemetry` — the telemetry + auto-degrade showcase (FR-15): healthy
 *   widgets beside the crasher (error degrade) and the laggard (latency-budget
 *   degrade), each degrade attributed to its instance.
 * - `demo.full-canvas` — one maximized, locked widget spanning the grid. An
 *   ordinary page type, not special-cased — the no-special-case proof.
 */
const DEMO_PAGE_TYPES: readonly DemoPageTypeInput[] = [
  {
    id: 'dashboards.home',
    context: {},
    allow_user_customization: true,
    layoutName: 'Home dashboard',
    // Static clock + markdown, a schema-validated chart, and the crasher — so the
    // home page exercises the static-props ABI and (via the crasher) proves the
    // per-widget error boundary isolates one failure while siblings render.
    items: [
      widget(WIDGET_TAGS.clock, {
        i: 'clock',
        x: 0,
        y: 0,
        w: 3,
        h: 2,
        props: { label: 'Local time', format: '24h', showSeconds: true },
      }),
      widget(WIDGET_TAGS.markdown, {
        i: 'notes',
        x: 3,
        y: 0,
        w: 5,
        h: 2,
        props: {
          label: 'Notes',
          markdown:
            '# Welcome to Gridmason\n\nThis dashboard is built from **first-party demo widgets** — each one a framework-agnostic custom element.\n\n- Drag widgets in *edit mode*\n- Widgets theme via CSS custom properties\n- See the [docs](https://gridmason.dev)',
        },
      }),
      widget(WIDGET_TAGS.chart, {
        i: 'chart',
        x: 8,
        y: 0,
        w: 4,
        h: 3,
        props: {
          label: 'Sales',
          title: 'Sales this month',
          kind: 'bar',
          unit: 'k USD',
          series: [
            { label: 'Mar', value: 182 },
            { label: 'Apr', value: 156 },
            { label: 'May', value: 221 },
            { label: 'Jun', value: 248 },
          ],
        },
      }),
      widget(WIDGET_TAGS.crasher, {
        i: 'crasher',
        x: 0,
        y: 2,
        w: 8,
        h: 3,
        props: { label: 'Broken widget', message: 'Deliberate demo crash on mount' },
      }),
    ],
  },
  {
    id: 'demo.record-detail',
    context: { record: { type: 'record-ref', recordType: 'customer' } },
    locks: ['header'],
    allow_user_customization: true,
    layoutName: 'Record detail',
    // The record-summary consumes the page's typed `record-ref` context in the
    // locked header; a chart and notes fill the customizable body.
    items: [
      widget(WIDGET_TAGS.recordSummary, {
        i: 'header',
        slot: 'header',
        x: 0,
        y: 0,
        w: 12,
        h: 2,
      }),
      widget(WIDGET_TAGS.chart, {
        i: 'metrics',
        // Slotted so an org publish can lock it (locks bind to slot ids, SPEC §5);
        // it is unlocked by default — the governance demo's org level pins it.
        slot: 'metrics',
        x: 0,
        y: 2,
        w: 6,
        h: 3,
        props: {
          title: 'Monthly spend',
          kind: 'line',
          unit: 'k USD',
          series: [
            { label: 'Q1', value: 42 },
            { label: 'Q2', value: 51 },
            { label: 'Q3', value: 47 },
            { label: 'Q4', value: 63 },
          ],
        },
      }),
      widget(WIDGET_TAGS.markdown, {
        i: 'notes',
        slot: 'notes',
        x: 6,
        y: 2,
        w: 6,
        h: 3,
        props: {
          label: 'Account notes',
          markdown:
            'Primary contact prefers email.\n\n- Renewal in **Q4**\n- Migrated to `stable-2026.07`',
        },
      }),
    ],
  },
  {
    id: 'demo.locked',
    context: {},
    locks: ['summary', 'activity', 'notes'],
    allow_user_customization: false,
    layoutName: 'Locked page',
    // A fully locked page: three widgets, no customization — nothing moves.
    items: [
      widget(WIDGET_TAGS.markdown, {
        i: 'summary',
        slot: 'summary',
        x: 0,
        y: 0,
        w: 6,
        h: 3,
        props: {
          label: 'Overview',
          markdown: '## Status board\n\nThis page is **fully locked** — users cannot rearrange it.',
        },
      }),
      widget(WIDGET_TAGS.chart, {
        i: 'activity',
        slot: 'activity',
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        props: {
          title: 'Throughput',
          kind: 'bar',
          series: [
            { label: 'Mon', value: 12 },
            { label: 'Tue', value: 19 },
            { label: 'Wed', value: 8 },
            { label: 'Thu', value: 15 },
            { label: 'Fri', value: 22 },
          ],
        },
      }),
      widget(WIDGET_TAGS.clock, {
        i: 'notes',
        slot: 'notes',
        x: 0,
        y: 3,
        w: 12,
        h: 2,
        props: { label: 'Server time', format: '24h', showSeconds: true, timeZone: 'UTC' },
      }),
    ],
  },
  {
    id: 'demo.telemetry',
    context: {},
    allow_user_customization: true,
    layoutName: 'Telemetry & auto-degrade',
    // The FR-15 showcase: two healthy widgets alongside the two degrade demos — the
    // crasher (an *error* degrade, boundary trips on mount) and the laggard (a
    // *latency-budget* degrade: declares pending, never becomes interactive, so the
    // canvas auto-degrades it to its fallback and the adapter flags it). Both
    // degrades are attributed to their instance via the telemetry adapter (SPEC §3).
    items: [
      widget(WIDGET_TAGS.clock, {
        i: 'clock',
        x: 0,
        y: 0,
        w: 3,
        h: 2,
        props: { label: 'Local time', format: '24h', showSeconds: true },
      }),
      widget(WIDGET_TAGS.chart, {
        i: 'chart',
        x: 3,
        y: 0,
        w: 5,
        h: 3,
        props: {
          label: 'Latency',
          title: 'Widget latency (ms)',
          kind: 'bar',
          series: [
            { label: 'clock', value: 4 },
            { label: 'chart', value: 11 },
            { label: 'slow', value: 1500 },
          ],
        },
      }),
      widget(WIDGET_TAGS.laggard, {
        i: 'laggard',
        x: 0,
        y: 2,
        w: 4,
        h: 3,
      }),
      widget(WIDGET_TAGS.crasher, {
        i: 'crasher',
        x: 4,
        y: 3,
        w: 4,
        h: 2,
        props: { label: 'Broken widget', message: 'Deliberate demo crash on mount' },
      }),
    ],
  },
  {
    id: 'demo.full-canvas',
    context: {},
    locks: ['main'],
    allow_user_customization: false,
    layoutName: 'Full canvas',
    // One maximized, locked chart spanning the grid — an ordinary page type, not
    // special-cased (the no-special-case proof).
    items: [
      widget(WIDGET_TAGS.chart, {
        i: 'main',
        slot: 'main',
        x: 0,
        y: 0,
        w: 12,
        h: 8,
        props: {
          title: 'Revenue by region',
          kind: 'bar',
          unit: 'k USD',
          series: [
            { label: 'NA', value: 412 },
            { label: 'EMEA', value: 288 },
            { label: 'APAC', value: 196 },
            { label: 'LATAM', value: 74 },
          ],
        },
      }),
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
