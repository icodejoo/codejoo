// Power-set correctness sweep — axp port of dioman's dioman_powerset_test.dart.
//
// Ported from dioman (Dio) to axp (axios). Two structural differences from
// the Dio original, both load-bearing for how this file's assertions differ:
//
//   1. LIFO/FIFO: Dio's interceptor chain is a single FIFO list — the same
//      install order applies to both onRequest and onResponse. Axios splits
//      this: request interceptors run LIFO (last `use()`d runs first),
//      response interceptors run FIFO (first `use()`d runs first) — see
//      src/plugin.ts's class doc. A single `.use()` order cannot reproduce
//      Dio's "same order both directions" on axios. This file picks ONE
//      canonical order (below, mirroring Dio's canonical list positions
//      1:1 minus `log`, which has no axp equivalent) and lets axios's real,
//      documented semantics decide the resulting behavior — it is NOT
//      asserting byte-identical internal traversal order to Dio, only that
//      axp's OWN composition is internally consistent per combination.
//
//   2. Unwrapping: Dio's DiomanNormalize is what unwraps the envelope
//      (`{code,data,message}` → `data`) — without it, callers see the raw
//      envelope. axp unwraps unconditionally at `Core`'s dispatch layer
//      (`shapeResponse` in src/core.ts), independent of any plugin.
//      `normalize` here does NOT unwrap — it only turns a business
//      failure (`code !== 0`) into a thrown `ApiError`. So unlike Dio, the
//      baseline success sweep's returned shape does NOT depend on whether
//      `normalize` is in the mask — it's always the unwrapped
//      `{ v: 1 }`, with or without it.
//
// Also unlike Dio's version, this uses `makeNetwork()` (in-process fake
// adapter, test/helpers/network.ts) instead of a real loopback HTTP server —
// no real sockets are opened, so none of Dio's TIME_WAIT/ephemeral-port
// pacing is needed here; the whole exception-path sweep runs in-process and
// fast.
//
// 12 plugins (dioman's 13 minus `log`, which axp has no equivalent for) →
// 2^12 - 1 = 4095 non-empty combinations per sweep (vs. dioman's 8191).
import { describe, it } from 'vitest';
import axios from 'axios';
import { create, envs, repath, filter, key, cache, share, mock, cancel, loading, auth, retry, normalize } from '../src';
import type { ITokenManager } from '../src';
import { makeNetwork } from './helpers/network';

class MutableTokenManager implements ITokenManager {
  canRefresh = true;
  #access: string | undefined;
  #refresh: string | undefined = 'refresh';
  constructor(access: string) { this.#access = access; }
  get accessToken() { return this.#access; }
  get refreshToken() { return this.#refresh; }
  set(access?: string, refresh?: string) {
    this.#access = access;
    if (refresh !== undefined) this.#refresh = refresh;
  }
  clear() { this.#access = undefined; }
}

// Canonical registration order — same relative order as Dio's Dioman.install
// list (envs, repath, filter, key, cache, share, mock, cancel, loading, auth,
// retry, [log dropped], normalize), renamed to axp's plugin names. See the
// file doc: this is a *choice*, not a re-derivation of Dio's exact traversal.
const _names = [
  'envs', 'repath', 'filter', 'key', 'cache', 'share', 'mock', //
  'cancel', 'loading', 'auth', 'retry', 'normalize',
] as const;

function _hasBit(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}
const _hasKey = (mask: number) => _hasBit(mask, 3);
const _hasCache = (mask: number) => _hasBit(mask, 4);
const _hasAuth = (mask: number) => _hasBit(mask, 9);
const _hasRetry = (mask: number) => _hasBit(mask, 10);

function _describe(mask: number): string {
  const out: string[] = [];
  for (let i = 0; i < _names.length; i++) if (mask & (1 << i)) out.push(_names[i]);
  return out.join('+');
}

/** Installs the subset of the 12 plugins selected by `mask`'s bits (bit i ↔
 *  `_names[i]`) onto a fresh Core, in the canonical order above.
 *  `retry`/`auth` are configured to recover in exactly 1 extra attempt so
 *  the exception-path phases stay deterministic and fast. */
function _install(adapter: any, mask: number, tm: MutableTokenManager) {
  const has = (bit: number) => _hasBit(mask, bit);
  const api = create(axios.create({ adapter }));
  const plugins = [];
  if (has(0)) plugins.push(envs([]));
  if (has(1)) plugins.push(repath());
  if (has(2)) plugins.push(filter());
  if (has(3)) plugins.push(key());
  if (has(4)) plugins.push(cache());
  if (has(5)) plugins.push(share({ policy: 'start' }));
  if (has(6)) plugins.push(mock()); // enable defaults false — installed but inert, matching Dio's DiomanMock(enabled:false)
  if (has(7)) plugins.push(cancel());
  if (has(8)) plugins.push(loading({ loading: () => {} }));
  if (has(9)) {
    plugins.push(auth({
      tokenManager: tm,
      onRefresh: async () => { tm.set('Bearer t1'); },
      onAccessExpired: async () => {},
    }));
  }
  if (has(10)) plugins.push(retry({ max: 1 }));
  if (has(11)) plugins.push(normalize());
  api.use(plugins);
  return api;
}

function headerOf(config: any, name: string): unknown {
  const h = config?.headers;
  if (!h) return undefined;
  if (typeof h.get === 'function') return h.get(name);
  return h[name] ?? h[name.toLowerCase()];
}

/** Per-request opt-in flags. `key` is deliberately gated on `_hasKey(mask)` —
 *  unlike the other flags, its VALUE (not just presence) is consumed
 *  downstream: cache's key-resolution falls back to reading `config.key`
 *  verbatim (trusting key to have overwritten it with a real hash
 *  string). Passing a literal `key: true` unconditionally would leak a
 *  stable-but-bogus cache key even when key is absent, producing a false
 *  "hit" between calls and breaking the documented no-op-without-key
 *  behavior this sweep is verifying. */
function reqCfg(mask: number): Record<string, unknown> {
  const cfg: Record<string, unknown> = { filter: true, cache: true };
  if (_hasKey(mask)) cfg.key = true;
  return cfg;
}

describe('axp power-set sweep — 12 plugins, 4095 combinations', () => {
  it('every non-empty subset returns the expected value on a plain success', async () => {
    const net = makeNetwork();
    let lastAuthHeader: unknown;
    net.on('GET', '/base', (config) => {
      lastAuthHeader = headerOf(config, 'Authorization');
      return { status: 200, data: { code: 0, data: { v: 1 }, message: '' } };
    });

    const failures: Record<string, string> = {};
    const total = (1 << _names.length) - 1;
    for (let mask = 1; mask <= total; mask++) {
      const name = _describe(mask);
      const api = _install(net.adapter, mask, new MutableTokenManager('Bearer t0'));
      lastAuthHeader = undefined;
      try {
        const r: any = await api.get('/base')(undefined, reqCfg(mask));
        if (r?.v !== 1) {
          failures[name] = `unexpected body ${JSON.stringify(r)}`;
        } else if (_hasAuth(mask) && lastAuthHeader !== 'Bearer t0') {
          failures[name] = `auth installed but server saw Authorization: ${lastAuthHeader}`;
        } else if (!_hasAuth(mask) && lastAuthHeader !== undefined) {
          failures[name] = `no auth but server still saw Authorization: ${lastAuthHeader}`;
        }
      } catch (e: any) {
        failures[name] = String(e?.message ?? e);
      }
    }

    if (Object.keys(failures).length) {
      const sample = Object.entries(failures).slice(0, 20).map(([k, v]) => `${k}: ${v}`).join('\n');
      throw new Error(`${Object.keys(failures).length}/${total} combinations failed (showing up to 20):\n${sample}`);
    }
  }, 180_000);

  it('every non-empty subset recovers correctly from a 500, a cache-populating round trip, and a 401 refresh+replay', async () => {
    const net = makeNetwork();
    const failures: Record<string, string> = {};
    const total = (1 << _names.length) - 1;

    for (let mask = 1; mask <= total; mask++) {
      const name = _describe(mask);
      const tm = new MutableTokenManager('Bearer t0');
      const api = _install(net.adapter, mask, tm);

      try {
        // --- retry: 500 then recovers -------------------------------
        if (_hasRetry(mask)) {
          let attemptCount = 0;
          net.on('GET', '/retry', () => {
            attemptCount++;
            return attemptCount < 2
              ? { status: 500, data: { code: 1, data: null, message: 'fail' } }
              : { status: 200, data: { code: 0, data: { v: 1 }, message: '' } };
          });
          const r: any = await api.get('/retry')(undefined, reqCfg(mask));
          if (r?.v !== 1) { failures[name] = `retry: unexpected result ${JSON.stringify(r)}`; continue; }
          if (attemptCount !== 2) { failures[name] = `retry: expected 2 attempts, got ${attemptCount}`; continue; }
        }

        // --- cache: 2 calls, hit iff key is also present ----------
        if (_hasCache(mask)) {
          let attemptCount = 0;
          net.on('GET', '/cache', () => {
            attemptCount++;
            return { status: 200, data: { code: 0, data: { v: 1 }, message: '' } };
          });
          const c1: any = await api.get('/cache')(undefined, reqCfg(mask));
          const c2: any = await api.get('/cache')(undefined, reqCfg(mask));
          if (c1?.v !== 1 || c2?.v !== 1) {
            failures[name] = `cache: unexpected body c1=${JSON.stringify(c1)} c2=${JSON.stringify(c2)}`;
            continue;
          }
          const expectedAttempts = _hasKey(mask) ? 1 : 2;
          if (attemptCount !== expectedAttempts) {
            failures[name] = _hasKey(mask)
              ? `cache+key: expected a cache hit (1 attempt), got ${attemptCount}`
              : `cache without key: expected NO cache hit (2 attempts), got ${attemptCount}`;
            continue;
          }
        }

        // --- auth: 401 then refresh+replay — run LAST, mutates tm ----
        if (_hasAuth(mask)) {
          let attemptCount = 0;
          let lastAuthHeader: unknown;
          net.on('GET', '/auth', (config) => {
            attemptCount++;
            lastAuthHeader = headerOf(config, 'Authorization');
            return attemptCount < 2
              ? { status: 401, data: { code: 1, data: null, message: 'fail' } }
              : { status: 200, data: { code: 0, data: { v: 1 }, message: '' } };
          });
          const a: any = await api.get('/auth')(undefined, reqCfg(mask));
          if (a?.v !== 1) { failures[name] = `auth: unexpected result ${JSON.stringify(a)}`; continue; }
          if (attemptCount !== 2) { failures[name] = `auth: expected 2 attempts, got ${attemptCount}`; continue; }
          if (lastAuthHeader !== 'Bearer t1') {
            failures[name] = `auth: expected replay to carry the refreshed token, server saw Authorization: ${lastAuthHeader}`;
            continue;
          }
          if (tm.accessToken !== 'Bearer t1') {
            failures[name] = `auth: token manager was not actually updated by onRefresh (still ${tm.accessToken})`;
            continue;
          }
        }
      } catch (e: any) {
        failures[name] = String(e?.message ?? e);
      }
    }

    if (Object.keys(failures).length) {
      const sample = Object.entries(failures).slice(0, 20).map(([k, v]) => `${k}: ${v}`).join('\n');
      throw new Error(`${Object.keys(failures).length}/${total} combinations failed (showing up to 20):\n${sample}`);
    }
  }, 180_000);
});
