/**
 * The demo **org publication** the governance showcase publishes (FR-4, SPEC §5).
 *
 * The governance demo governs one page — a `demo.record-detail` customer page —
 * to make the 3-level resolution watchable: a page-type **default** ships the
 * baseline (with a locked `header` slot), an operator **publishes** this org
 * layout on top of it (re-arranging the body and **locking the `metrics` chart**),
 * and the signed-in user then **overrides** the parts the org left free (the
 * `notes` slot) before **resetting** back to the org standard.
 *
 * Locks are supplied to `resolveLayout` as a separate slot-id list, not baked
 * into the {@link LayoutPage}. `ORG_PUBLICATION` therefore pairs a layout with
 * its `locks`: `header` stays governed by the page-type default level, and the
 * org adds `metrics` — so the effective page locks both, while `notes` remains
 * the user's to move.
 */
import { CURRENT_LAYOUT_SCHEMA_VERSION, type LayoutPage } from '@gridmason/protocol';
import { LOCAL_SOURCE, WIDGET_TAGS } from '../boot/import-map';
import type { OrgPublication } from '../adapters/governance';
import type { PageRef } from '../routes';

/** The page the governance demo governs: a typed customer record-detail page. */
export const GOVERNED_PAGE: PageRef = {
  pageType: 'demo.record-detail',
  entityId: 'gov-demo',
};

/** The org scope-node the demo publishes under (matches the resolution's org level). */
export const ORG_NODE = 'org';

/** The slot the org adds to the page-type's own locks when it publishes (SPEC §5). */
export const ORG_LOCKED_SLOT = 'metrics';

/**
 * The org's published layout for {@link GOVERNED_PAGE}: the same three slotted
 * widgets as the page-type default, re-arranged into the organization's standard
 * — a wider pinned `metrics` chart beside a narrower `notes` panel, under the
 * governed `header`. This is the layout a user inherits before their first edit.
 */
const ORG_LAYOUT: LayoutPage = {
  schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
  page: GOVERNED_PAGE.pageType,
  name: 'Support desk standard',
  default: false,
  hasTabs: false,
  grid: {
    items: [
      {
        widgetID: { source: LOCAL_SOURCE, tag: WIDGET_TAGS.recordSummary },
        i: 'header',
        slot: 'header',
        x: 0,
        y: 0,
        w: 12,
        h: 2,
      },
      {
        widgetID: { source: LOCAL_SOURCE, tag: WIDGET_TAGS.chart },
        i: 'metrics',
        slot: 'metrics',
        x: 0,
        y: 2,
        w: 8,
        h: 3,
        props: {
          title: 'Account health',
          kind: 'bar',
          unit: 'score',
          series: [
            { label: 'Jan', value: 72 },
            { label: 'Feb', value: 68 },
            { label: 'Mar', value: 81 },
            { label: 'Apr', value: 90 },
          ],
        },
      },
      {
        widgetID: { source: LOCAL_SOURCE, tag: WIDGET_TAGS.markdown },
        i: 'notes',
        slot: 'notes',
        x: 8,
        y: 2,
        w: 4,
        h: 3,
        props: {
          label: 'Playbook',
          markdown: '### Support playbook\n\n- Greet within **2 min**\n- Confirm the account\n- Log every touch',
        },
      },
    ],
  },
  tabs: [],
};

/** The complete org publication the demo publishes: the org layout + its locks. */
export const ORG_PUBLICATION: OrgPublication = {
  layout: ORG_LAYOUT,
  locks: [ORG_LOCKED_SLOT],
};
