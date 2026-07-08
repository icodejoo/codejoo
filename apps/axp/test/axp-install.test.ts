// Each test here is constructed so it FAILS if Axp.install's canonical
// order were wrong — not just "happens to pass regardless of order". See
// src/install.ts's class doc for the derivation.
import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp, axpKey as key, axpFilter as filter, axpCache as cache, axpAuth as auth, axpRetry as retry, axpNormalize as normalize } from '../src';
import { makeNetwork } from './helpers/network';

function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

class FakeTokenManager {
  canRefresh = true;
  #access: string | undefined;
  constructor(access: string | undefined) { this.#access = access; }
  get accessToken() { return this.#access; }
  get refreshToken() { return 'refresh'; }
  set(access?: string) { this.#access = access; }
  clear() { this.#access = undefined; }
}

describe('Axp.install — canonical order', () => {
  it('filter runs before key on request: an empty field stripped by filter must not affect the hash key computes', async () => {
    const { net, api } = mkApi();
    let calls = 0;
    net.on('POST', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    Axp.install(api.axios, { key: key({ fastMode: false }), filter: filter(), cache: cache() });

    // Same after cleaning (blank stripped), different before — if key ran
    // first (wrong order), these would hash differently and both would miss.
    await api.axios.post('/data', { a: 1, blank: '' }, { key: true, filter: true, cache: true } as any);
    await api.axios.post('/data', { a: 1 }, { key: true, filter: true, cache: true } as any);
    expect(calls).toBe(1);
  });

  it('auth runs before retry on response: a 401 gets refreshed+replayed WITHOUT retry burning attempts on the stale token first', async () => {
    // The server checks the ACTUAL Authorization header, not just attempt
    // count — a blind retry with the still-stale token must keep failing.
    // Only a genuinely refreshed token ('Bearer t1') gets 200. This is what
    // makes the test catch a wrong-order regression instead of passing by
    // coincidence (a naive "200 on attempt >= 2" server can't tell the
    // difference between "auth refreshed" and "retry got lucky").
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback((config) => {
      attempts++;
      const authHeader = (config.headers as any)?.Authorization ?? (config.headers as any)?.['authorization'];
      return authHeader === 'Bearer t1'
        ? { status: 200, data: { code: 0, data: { v: 1 } } }
        : { status: 401, data: { code: 1, data: null } };
    });
    const tm = new FakeTokenManager('Bearer t0');
    Axp.install(api.axios, {
      auth: auth({ tokenManager: tm as any, onRefresh: async () => { tm.set('Bearer t1'); }, onAccessExpired: async () => {} }),
      // shouldRetry gated to 401 only — this test is about ordering (auth before
      // retry), not retry's own default status gate (>=500 wouldn't otherwise fire
      // on a 401). Must NOT also say "retry" on the eventual 200, or retry's own
      // loop would burn its own budget on an already-successful response too.
      retry: retry({ max: 2, delay: 0, shouldRetry: (r, e) => (r?.status ?? e?.status) === 401 }),
    });

    const r = await api.axios.get('/data');
    expect((r.data as any).data.v).toBe(1);
    // Wrong order (retry first) would burn its own max=2 retries on the
    // stale token before auth ever got a look: 3 failed attempts + 1
    // eventual auth replay = 4. Right order: 401, then one refreshed
    // replay = 2.
    expect(attempts).toBe(2);
  });

  it('normalize runs last on response: retry gets first crack at a business failure via shouldRetry before normalize hard-rejects it', async () => {
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => {
      attempts++;
      return attempts < 2
        ? { data: { code: 1, data: null, message: 'fail' } }
        : { data: { code: 0, data: { v: 1 }, message: '' } };
    });
    Axp.install(api.axios, {
      retry: retry({ max: 2, delay: 0, shouldRetry: (r) => (r?.data as any)?.code !== 0 }),
      normalize: normalize(),
    });

    const r = await api.axios.get('/data');
    expect((r.data as any).data.v).toBe(1);
    expect(attempts).toBe(2);
  });

  it('omitted plugins are skipped; a single plugin still installs correctly', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { v: 1 } } }));
    const handle = Axp.install(api.axios, { key: key() });
    expect(handle.plugins.map((p) => p.name)).toEqual(['axp:key']);
  });

  it('the returned AxpHandle looks up installed plugins by name and dispose() ejects exactly that batch', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { v: 1 } } }));
    const handle = Axp.install(api.axios, { key: key(), cache: cache() });

    expect(handle.plugins.map((p) => p.name)).toEqual(['axp:key', 'axp:cache']);
    expect(handle.plugin('axp:cache')).toBeTruthy();
    expect(handle.plugin('nope')).toBeUndefined();

    handle.dispose();
    expect(handle.plugins).toEqual([]);
  });

  const namedPlugin = (name: string) => ({ name, install() {} });

  it('append adds after everything the handle tracks', () => {
    const { api } = mkApi();
    const handle = Axp.install(api.axios, { key: key(), cache: cache() });
    handle.append(namedPlugin('custom'));
    expect(handle.plugins.map((p) => p.name)).toEqual(['axp:key', 'axp:cache', 'custom']);
  });

  it('prepend adds before everything the handle tracks', () => {
    const { api } = mkApi();
    const handle = Axp.install(api.axios, { key: key(), cache: cache() });
    handle.prepend(namedPlugin('custom'));
    expect(handle.plugins.map((p) => p.name)).toEqual(['custom', 'axp:key', 'axp:cache']);
  });

  it('insertBefore/insertAfter slot a plugin relative to a tracked anchor', () => {
    const { api } = mkApi();
    const handle = Axp.install(api.axios, { key: key(), cache: cache() });
    const keyPlugin = handle.plugin('axp:key')!;
    handle.insertAfter(keyPlugin, namedPlugin('middle'));
    expect(handle.plugins.map((p) => p.name)).toEqual(['axp:key', 'middle', 'axp:cache']);

    handle.insertBefore(keyPlugin, namedPlugin('front'));
    expect(handle.plugins.map((p) => p.name)).toEqual(['front', 'axp:key', 'middle', 'axp:cache']);
  });

  it('insertBefore/insertAfter throw for an anchor this handle does not track', () => {
    const { api } = mkApi();
    const handle = Axp.install(api.axios, { key: key() });
    const foreign = namedPlugin('foreign');
    expect(() => handle.insertBefore(foreign, namedPlugin('x'))).toThrow();
    expect(() => handle.insertAfter(foreign, namedPlugin('x'))).toThrow();
  });
});
