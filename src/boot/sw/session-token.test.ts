import { describe, expect, it } from 'vitest';
import {
  isSameOriginApiRequest,
  isSessionTokenMessage,
  SESSION_AUTH_HEADER,
  SESSION_TOKEN_MESSAGE_TYPE,
  SessionTokenHolder,
} from './session-token';

describe('isSessionTokenMessage', () => {
  it('accepts a token to remember and a null to clear', () => {
    expect(isSessionTokenMessage({ type: SESSION_TOKEN_MESSAGE_TYPE, token: 'abc' })).toBe(true);
    expect(isSessionTokenMessage({ type: SESSION_TOKEN_MESSAGE_TYPE, token: null })).toBe(true);
  });
  it('rejects other shapes', () => {
    expect(isSessionTokenMessage({ type: 'other', token: 'x' })).toBe(false);
    expect(isSessionTokenMessage({ type: SESSION_TOKEN_MESSAGE_TYPE, token: 42 })).toBe(false);
    expect(isSessionTokenMessage(null)).toBe(false);
  });
});

describe('isSameOriginApiRequest', () => {
  const origin = 'https://app.example';
  it('matches same-origin /api paths only', () => {
    expect(isSameOriginApiRequest('https://app.example/api/records/customer/c1', origin)).toBe(true);
    expect(isSameOriginApiRequest('https://app.example/api', origin)).toBe(true);
    expect(isSameOriginApiRequest('https://app.example/assets/x.js', origin)).toBe(false);
    expect(isSameOriginApiRequest('https://cdn.other/api/records', origin)).toBe(false);
    expect(isSameOriginApiRequest('not a url', origin)).toBe(false);
  });
});

describe('SessionTokenHolder', () => {
  it('holds no token until one is remembered', () => {
    const holder = new SessionTokenHolder();
    expect(holder.has()).toBe(false);
    // A no-op stamp when nothing is held (passthrough).
    expect(holder.stamp({ 'x-foo': 'bar' })).toEqual({ 'x-foo': 'bar' });
    expect(holder.stamp({})).toEqual({});
  });

  it('stamps the session credential under the auth header once remembered', () => {
    const holder = new SessionTokenHolder();
    holder.remember('sess-123');
    expect(holder.has()).toBe(true);
    const stamped = holder.stamp({ 'content-type': 'application/json' });
    expect(stamped[SESSION_AUTH_HEADER]).toBe('Bearer sess-123');
    expect(stamped['content-type']).toBe('application/json');
  });

  it('overrides a page-supplied auth header (no spoofing / suppression)', () => {
    const holder = new SessionTokenHolder();
    holder.remember('real');
    const stamped = holder.stamp({ Authorization: 'Bearer forged' });
    // Exactly one auth header, carrying the real token.
    const authKeys = Object.keys(stamped).filter((k) => k.toLowerCase() === SESSION_AUTH_HEADER);
    expect(authKeys).toEqual([SESSION_AUTH_HEADER]);
    expect(stamped[SESSION_AUTH_HEADER]).toBe('Bearer real');
  });

  it('never exposes the raw token — the only egress is a stamped header', () => {
    const holder = new SessionTokenHolder();
    holder.remember('secret-token');
    // No accessor returns the bare token; it appears only inside the Bearer header.
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(holder));
    expect(surface).not.toContain('getToken');
    expect(surface).not.toContain('token');
    expect(JSON.stringify(holder)).not.toContain('secret-token');
    expect(holder.stamp({})[SESSION_AUTH_HEADER]).toContain('secret-token');
  });

  it('clears the token (logout / null hand-off)', () => {
    const holder = new SessionTokenHolder();
    holder.remember('sess');
    holder.clear();
    expect(holder.has()).toBe(false);
    expect(holder.stamp({})).toEqual({});
  });
});
