import { afterEach, describe, expect, it } from 'vitest';
import { installSideloadHost, sideloadHost, type SideloadHost } from './host-seam';

const NOOP_HOST: SideloadHost = {
  remotes: () => [],
  describe: () => undefined,
  widgetIdForInstance: () => undefined,
};

afterEach(() => installSideloadHost(null));

describe('sideload host seam', () => {
  it('is null until a host is installed', () => {
    expect(sideloadHost()).toBeNull();
  });

  it('returns the installed host', () => {
    installSideloadHost(NOOP_HOST);
    expect(sideloadHost()).toBe(NOOP_HOST);
  });

  it('clears the installed host with null', () => {
    installSideloadHost(NOOP_HOST);
    installSideloadHost(null);
    expect(sideloadHost()).toBeNull();
  });
});
