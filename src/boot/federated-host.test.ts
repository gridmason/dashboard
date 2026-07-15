import { afterEach, describe, expect, it } from 'vitest';
import type { WidgetID } from '@gridmason/protocol';
import type { LocalRemote } from './import-map';
import { federatedHost, installFederatedHost, type FederatedHost } from './federated-host';

const REGISTRY = 'registry.gridmason.dev';

function remote(tag: string): LocalRemote {
  return {
    tag,
    source: REGISTRY,
    name: tag,
    specifier: `${REGISTRY}/${tag}`,
    load: () => Promise.resolve(),
  };
}

function host(remotes: readonly LocalRemote[]): FederatedHost {
  return {
    remotes: () => remotes,
    describe: (id: WidgetID) => remotes.find((r) => r.source === id.source && r.tag === id.tag)?.name,
    killedInstanceIds: () => [],
  };
}

afterEach(() => installFederatedHost(null));

describe('federated-host seam (SPEC §2; FR-10)', () => {
  it('is null until a provider installs a host', () => {
    expect(federatedHost()).toBeNull();
  });

  it('reads back the installed host and its remotes', () => {
    installFederatedHost(host([remote('acme-chart')]));
    expect(federatedHost()?.remotes().map((r) => r.tag)).toEqual(['acme-chart']);
    expect(federatedHost()?.describe({ source: REGISTRY, tag: 'acme-chart' })).toBe('acme-chart');
    expect(federatedHost()?.describe({ source: REGISTRY, tag: 'unknown' })).toBeUndefined();
  });

  it('clears back to null when uninstalled', () => {
    installFederatedHost(host([remote('acme-chart')]));
    installFederatedHost(null);
    expect(federatedHost()).toBeNull();
  });
});
