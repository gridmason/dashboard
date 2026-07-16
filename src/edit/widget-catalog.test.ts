/**
 * The picker's pure catalog logic (issue #85): the local first-party list, and the
 * security-critical addability rule — a registry catalog entry is addable **only
 * if** the boot admitted a remote for it (gated + verified), never merely because
 * the catalog lists it.
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_SOURCE } from '@gridmason/protocol';
import { localCatalogEntries, resolveCatalogAddability, type AdmittedRemote } from './widget-catalog';

describe('localCatalogEntries', () => {
  it('lists the first-party widgets, all local-sourced', () => {
    const entries = localCatalogEntries();
    const tags = entries.map((e) => e.tag);
    expect(tags).toContain('gm-clock-widget');
    expect(tags).toContain('gm-chart-widget');
    for (const entry of entries) {
      expect(entry.widgetID.source).toBe(LOCAL_SOURCE);
      expect(entry.widgetID.tag).toBe(entry.tag);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveCatalogAddability', () => {
  const admitted: readonly AdmittedRemote[] = [
    { source: 'localhost-registry', tag: 'localdemo-clock' },
  ];

  it('makes a gated + verified (admitted) entry addable, inserting the admitted identity', () => {
    const result = resolveCatalogAddability({ tag: 'localdemo-clock' }, admitted);
    expect(result.addable).toBe(true);
    // The inserted identity is the admitted remote's own (source + tag), not reconstructed.
    expect(result.widgetID).toEqual({ source: 'localhost-registry', tag: 'localdemo-clock' });
  });

  it('leaves an ungated/unadmitted entry NOT addable (no bypass of the gate/verify chain)', () => {
    const result = resolveCatalogAddability({ tag: 'localdemo-uncleared' }, admitted);
    expect(result.addable).toBe(false);
    expect(result.widgetID).toBeUndefined();
  });

  it('is not addable when nothing is admitted (no federated boot)', () => {
    expect(resolveCatalogAddability({ tag: 'localdemo-clock' }, []).addable).toBe(false);
  });
});
