// axp port of dioman's dioman_coverage_test.dart — secondary options,
// management APIs, and less-common branches not covered by the per-plugin
// *.test.ts files or dioman-powerset.test.ts.
//
// Several Dio-side APIs this file originally targeted have NO axp
// equivalent — axp's plugins are stateless `{name, install}` factories, not
// retained class instances with external management methods. Those cases
// are `it.skip(...)` with a reason, so the gap stays visible in the test
// report instead of silently vanishing:
//   - DiomanShare.registerDownstreamSettler/.hasMultipleDownstreamSettlers/
//     .settle()/.dispose() — axp's share is a pure adapter wrapper with no
//     retained instance or external settlement API (dedup happens beneath
//     the whole interceptor chain, so it never needed a "defer to a
//     downstream settler" protocol in the first place).
//   - DiomanCache.removeWhere()/.size — axp only exports removeCache(ax,key)
//     /clearCache(ax); no removeWhere, no size introspection.
//   - DiomanMock.add()/.remove()/.reset() (inline in-process handler table)
//     — axp's mock is mockUrl-redirect only, no inline handler registration.
//   - DiomanLog — no logging plugin exists in axp at all.
//   - DiomanRepath per-request `extra['dioman:repath']` override — axp's
//     repath.ts reads no per-request config; plugin-level options only.
//   - DiomanNormalize's `shouldNormalize` override and `ApiException` — axp's
//     normalize has no envelope-detection override, and its
//     `ApiError`/`ApiResponse` don't have Dio's `ApiException.toString()`
//     format.
//   - DiomanAuth's raw-token-stash vs header-fallback nuance — axp's
//     `authFailureFactory` always reads the header directly; there's no
//     separate stashed-raw-token code path to exercise.
//   - DiomanRetry's default `retryIf` status-code selectivity (e.g. "404
//     doesn't retry") — axp's retry has no such gate: any rejected request
//     retries unconditionally up to `max`. This is a genuine behavior
//     difference from Dio, not a missing feature — see the test below that
//     documents axp's actual (unconditional) behavior instead.
import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import {
  create, envs, repath, filter, key, cache, share, mock, cancel, auth,
  retry, normalize, clearCache, ApiError,
} from '../src';
import { authFailureFactory, AuthFailureAction } from '../src/plugins/auth';
import { $shouldFallback } from '../src/plugins/mock';
import { makeNetwork } from './helpers/network';

class FakeTokenManager {
  canRefresh = true;
  #access: string | undefined;
  constructor(access: string | undefined) { this.#access = access; }
  get accessToken() { return this.#access; }
  get refreshToken() { return 'refresh'; }
  set(access?: string) { this.#access = access; }
  clear() { this.#access = undefined; }
}

function mkApi() {
  const net = makeNetwork();
  const api = create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

// ───────────────────────────────────────────────────────────────────────────

describe('envs', () => {
  it('the first matching rule wins and its config is shallow-merged into axios.defaults; a later, also-matching rule is never even evaluated', () => {
    const ax = axios.create();
    const api = create(ax);
    let secondRuleEvaluated = false;
    api.use(envs([
      { rule: () => true, config: { baseURL: 'https://prod.example.com', timeout: 5000, headers: { 'X-Env': 'prod' } } },
      { rule: () => { secondRuleEvaluated = true; return true; }, config: { baseURL: 'https://staging.example.com' } },
    ]));

    expect(ax.defaults.baseURL).toBe('https://prod.example.com');
    expect(ax.defaults.timeout).toBe(5000);
    // envs.ts applies via a flat Object.assign(defaults, config) — no axios
    // header normalization, so this lands exactly where it was given.
    expect((ax.defaults.headers as any)['X-Env']).toBe('prod');
    expect(secondRuleEvaluated).toBe(false);
  });

  it('no matching rule leaves axios.defaults untouched', () => {
    const ax = axios.create({ baseURL: 'https://default.example.com' });
    const api = create(ax);
    api.use(envs([{ rule: () => false, config: { baseURL: 'https://x' } }]));
    expect(ax.defaults.baseURL).toBe('https://default.example.com');
  });

  it('eject() reverts the applied config via the auto-registered cleanup snapshot', () => {
    const ax = axios.create({ baseURL: 'https://default.example.com' });
    const api = create(ax);
    api.use(envs([{ rule: () => true, config: { baseURL: 'https://x' } }]));
    expect(ax.defaults.baseURL).toBe('https://x');
    api.eject('envs');
    expect(ax.defaults.baseURL).toBe('https://default.example.com');
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('repath', () => {
  it('{id}/:id placeholders are substituted from params, and removed from it by default', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.on('GET', '/user/42/posts/7', (config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    api.use([repath()]);

    const r = await api.axios.get('/user/{id}/posts/:postId', { params: { id: 42, postId: 7, page: 1 } });
    expect(seenUrl).toBe('/user/42/posts/7');
    expect(r.config.params).toEqual({ page: 1 });
  });

  it('falls back to the data map when a placeholder is not in params, and removeKey:false keeps the source key', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.on('POST', '/user/99', (config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    api.use([repath({ removeKey: false })]);

    const r = await api.axios.post('/user/{id}', { id: 99 });
    expect(seenUrl).toBe('/user/99');
    // r.config.data reflects the post-transformRequest value (axios's
    // default JSON.stringify runs between repath's interceptor and here).
    expect(JSON.parse(r.config.data as string)).toEqual({ id: 99 });
  });

  it('the default removeKey:true also removes a data-map substitution', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.on('POST', '/user/99', (config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    api.use([repath()]);

    const r = await api.axios.post('/user/{id}', { id: 99 });
    expect(seenUrl).toBe('/user/99');
    expect(JSON.parse(r.config.data as string)).toEqual({});
  });

  it('a placeholder with no match in either params or data is left as-is in the path', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.fallback((config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    api.use([repath()]);

    await api.axios.get('/user/{id}');
    expect(seenUrl).toBe('/user/{id}');
  });

  it('a constructor-level disabled repath never substitutes', async () => {
    const { net, api } = mkApi();
    let seenUrl = '';
    net.fallback((config) => { seenUrl = config.url ?? ''; return { data: { code: 0, data: null } }; });
    api.use([repath({ enable: false })]);

    await api.axios.get('/user/{id}', { params: { id: 42 } });
    expect(seenUrl).toBe('/user/{id}');
  });

  it.skip('per-request DiomanRepathOptions override — axp\'s repath.ts reads no per-request config at all, only plugin-level options; there is no equivalent to Dio\'s extra[\'dioman:repath\'] override', () => {});
});

// ───────────────────────────────────────────────────────────────────────────

describe('filter', () => {
  it('the default predicate drops empty/whitespace-only strings, null and NaN, and filters both params and data the same way', async () => {
    const { net, api } = mkApi();
    let seenParams: any;
    let seenData: any;
    net.on('GET', '/data', (config) => { seenParams = config.params; return { data: { code: 0, data: null } }; });
    net.on('POST', '/data', (config) => { seenData = config.data; return { data: { code: 0, data: null } }; });
    api.use([filter()]);

    await api.axios.get('/data', { params: { keep: 'x', blank: '   ', empty: '' }, filter: true } as any);
    expect(seenParams).toEqual({ keep: 'x' });

    await api.axios.post('/data', { keep: 1, dropMe: null, blank: '  ' }, { filter: true } as any);
    // axios's default transformRequest JSON.stringifies the body between
    // filter's request interceptor and the adapter — the mock route
    // handler sees the post-transform string, not the live object.
    expect(JSON.parse(seenData)).toEqual({ keep: 1 });
  });

  it('without config.filter:true, filter is a no-op (per-request opt-in, unlike Dio\'s always-on DiomanFilter)', async () => {
    const { net, api } = mkApi();
    let seenParams: any;
    net.on('GET', '/data', (config) => { seenParams = config.params; return { data: { code: 0, data: null } }; });
    api.use([filter()]);

    await api.axios.get('/data', { params: { blank: '' } });
    expect(seenParams).toEqual({ blank: '' });
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('key', () => {
  it('without config.key:true, key never writes a key, so cache installed after it never caches', async () => {
    const { net, api } = mkApi();
    let calls = 0;
    net.on('GET', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    api.use([key(), cache()]);

    await api.axios.get('/data', { cache: true } as any);
    await api.axios.get('/data', { cache: true } as any);
    expect(calls).toBe(2);
  });

  it('deep mode folds params and a plain-object body into the key, order-independently, so two requests differing only in body get different cache entries', async () => {
    // `key: true` alone defaults to FAST mode (method+url only) unless the
    // plugin is configured with fastMode:false — see key.ts's `$parse`
    // (`build === true` branch: `defaults?.fastMode ?? true`).
    const { net, api } = mkApi();
    let calls = 0;
    net.on('POST', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    api.use([key({ fastMode: false }), cache()]);

    await api.axios.post('/data', { x: 1 }, { params: { b: 2, a: 1 }, key: true, cache: true } as any);
    await api.axios.post('/data', { x: 1 }, { params: { a: 1, b: 2 }, key: true, cache: true } as any);
    expect(calls).toBe(1);

    await api.axios.post('/data', { x: 2 }, { params: { a: 1, b: 2 }, key: true, cache: true } as any);
    expect(calls).toBe(2);
  });

  it('a string body is folded into the key as-is', async () => {
    const { net, api } = mkApi();
    let calls = 0;
    net.on('POST', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    api.use([key({ fastMode: false }), cache()]);

    await api.axios.post('/data', 'raw-body', { key: true, cache: true } as any);
    await api.axios.post('/data', 'raw-body', { key: true, cache: true } as any);
    expect(calls).toBe(1);

    await api.axios.post('/data', 'different-body', { key: true, cache: true } as any);
    expect(calls).toBe(2);
  });

  it('a class instance with no own enumerable properties contributes nothing to the key (unlike Dio\'s JSON-encode-fails-toString-fallback — JS object keys are always strings, so there\'s no encode-failure branch; an "empty" object is just treated as absent)', async () => {
    class Unencodable { toString() { return 'unencodable'; } }
    const { net, api } = mkApi();
    let calls = 0;
    net.on('GET', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    api.use([key({ fastMode: false }), cache()]);

    await api.axios.get('/data', { params: { x: new Unencodable() }, key: true, cache: true } as any);
    await api.axios.get('/data', { params: { x: new Unencodable() }, key: true, cache: true } as any);
    expect(calls).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('cache management API', () => {
  it('removeCache()/clearCache() operate on the live per-instance store (no removeWhere/.size in axp — see file doc)', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: null } }));
    api.use([key(), cache()]);

    await api.axios.get('/a', { key: true, cache: true } as any);
    await api.axios.get('/b', { key: true, cache: true } as any);
    let calls = 0;
    net.on('GET', '/a', () => { calls++; return { data: { code: 0, data: null } }; });

    // Without knowing the exact hashed value, removeCache needs the real
    // key — the `key` plugin writes it onto the resolved request config;
    // simplest external proof-of-life is clearCache() wiping everything.
    const cleared = clearCache(api.axios);
    expect(cleared).toBe(2);
    await api.axios.get('/a', { key: true, cache: true } as any);
    expect(calls).toBe(1); // real call again post-clear
  });

  it('an expired entry is evicted on the next request for that key, not served stale', async () => {
    // vi.useFakeTimers() also fakes makeNetwork()'s own internal
    // setTimeout(fn, latency) — every request's promise needs an explicit
    // vi.advanceTimersByTimeAsync() to ever resolve, not just the "let the
    // TTL pass" advance. Skipping this on the FIRST request hangs forever.
    vi.useFakeTimers();
    try {
      const { net, api } = mkApi();
      let calls = 0;
      net.on('GET', '/data', () => { calls++; return { data: { code: 0, data: { v: calls } } }; });
      api.use([key(), cache({ expires: 1000 })]);

      const p1 = api.axios.get('/data', { key: true, cache: true } as any);
      await vi.advanceTimersByTimeAsync(0);
      const r1: any = await p1.then(r => r.data.data);
      expect(r1.v).toBe(1);

      await vi.advanceTimersByTimeAsync(2000); // past the 1000ms TTL
      const p2 = api.axios.get('/data', { key: true, cache: true } as any);
      await vi.advanceTimersByTimeAsync(0);
      const r2: any = await p2.then(r => r.data.data);
      expect(r2.v).toBe(2);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clone:"shallow" returns a distinct top-level container without deep-copying nested objects', async () => {
    // `cache: true` (boolean) is documented to always mean shared-reference,
    // clone-free — the plugin-level clone policy only applies when the
    // per-request config uses the OBJECT form (`cache: {}`), per
    // $resolveCache's `v === true` branch omitting `clone` entirely.
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { nested: { v: 1 } } } }));
    api.use([key(), cache({ clone: 'shallow' })]);

    const r1 = await api.axios.get('/data', { key: true, cache: {} } as any);
    const r2 = await api.axios.get('/data', { key: true, cache: {} } as any);
    expect(r2.data).toEqual(r1.data);
    expect(r2.data).not.toBe(r1.data);
    expect((r2.data as any).data.nested).toBe((r1.data as any).data.nested); // shallow — nested still shared
  });

  it('clone:"deep" recursively copies nested objects, so mutating one hit never affects another', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { nested: { v: 1 } } } }));
    api.use([key(), cache({ clone: 'deep' })]);

    const r1 = await api.axios.get('/data', { key: true, cache: {} } as any);
    const r2 = await api.axios.get('/data', { key: true, cache: {} } as any);
    (r2.data as any).data.nested.v = 999;
    const r3 = await api.axios.get('/data', { key: true, cache: true } as any);
    expect((r3.data as any).data.nested.v).toBe(1);
    expect(r1.data).not.toBe(r2.data);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('share: end policy', () => {
  it('only the LATEST caller settles the shared promise — an earlier, superseded caller for the same key is redirected to that result instead of its own', async () => {
    // makeNetwork()'s route handler must return synchronously — it does NOT
    // await a returned Promise (`'data' in out` is false for a thenable, so
    // it silently falls back to `{code:0,data:null}`). Sequencing "a is
    // still in flight when b lands" is done via relative `latency` instead
    // of a manual release gate: `hit` is assigned at dispatch time (before
    // the delay), so the first-DISPATCHED call is reliably "a" regardless
    // of which one's timer fires first.
    const { net, api } = mkApi();
    net.on('GET', '/data', (_config, hit) => hit === 1
      ? { data: { code: 0, data: { v: 'a-stale' } } }
      : { data: { code: 0, data: { v: 'b-latest' } } });
    api.use([key(), share({ policy: 'end' })]);

    const a = api.axios.get('/data', { key: true, share: 'end', latency: 30 } as any);
    await new Promise((r) => setTimeout(r, 5)); // ensure a dispatches first
    const b = await api.axios.get('/data', { key: true, share: 'end', latency: 5 } as any);
    const aResult: any = await a;

    expect((b.data as any).data.v).toBe('b-latest');
    expect(aResult.data.data.v).toBe('b-latest');
  });

  it('a solo caller (no supersession) just settles with its own result', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { v: 1 } } }));
    api.use([key(), share({ policy: 'end' })]);
    const r: any = await api.axios.get('/data', { key: true, share: 'end' } as any);
    expect(r.data.data.v).toBe(1);
  });

  it('a solo caller whose own request fails settles the entry with that failure', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 500, data: { code: 1, data: null } }));
    api.use([key(), share({ policy: 'end' })]);
    await expect(api.axios.get('/data', { key: true, share: 'end' } as any)).rejects.toBeTruthy();
  });
});

describe('share: race policy', () => {
  it('the first attempt to SUCCEED wins for everyone, including a slower attempt still in flight', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/data', (_config, hit) => hit === 1
      ? { data: { code: 0, data: { v: 'slow' } } }
      : { data: { code: 0, data: { v: 'fast' } } });
    api.use([key(), share({ policy: 'race' })]);

    const slow = api.axios.get('/data', { key: true, share: 'race', latency: 30 } as any);
    await new Promise((r) => setTimeout(r, 5)); // ensure slow dispatches first
    const fast: any = await api.axios.get('/data', { key: true, share: 'race', latency: 5 } as any);
    const slowResult: any = await slow;

    expect(fast.data.data.v).toBe('fast');
    expect(slowResult.data.data.v).toBe('fast');
  });

  it('only once every in-flight attempt has failed does the race settle as a failure for everyone', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 500, data: { code: 1, data: null } }));
    api.use([key(), share({ policy: 'race' })]);
    await expect(api.axios.get('/data', { key: true, share: 'race' } as any)).rejects.toBeTruthy();
  });
});

describe('share: none policy and no-key no-op', () => {
  it('without key installed, share is a no-op — every call is independent', async () => {
    const { net, api } = mkApi();
    let calls = 0;
    net.on('GET', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    api.use([share({ policy: 'start' })]);
    await Promise.all([api.axios.get('/data'), api.axios.get('/data')]);
    expect(calls).toBe(2);
  });

  it('policy:"none" passes every request through independently — never shared', async () => {
    const { net, api } = mkApi();
    let calls = 0;
    net.on('GET', '/data', () => { calls++; return { status: 500, data: { code: 1, data: null } }; });
    api.use([key(), share({ policy: 'none' })]);
    await expect(api.axios.get('/data', { key: true, share: 'none' } as any)).rejects.toBeTruthy();
    await expect(api.axios.get('/data', { key: true, share: 'none' } as any)).rejects.toBeTruthy();
    expect(calls).toBe(2);
  });
});

describe.skip('share: registerDownstreamSettler / hasMultipleDownstreamSettlers / settle() / dispose() — no axp equivalent, see file doc', () => {});

// ───────────────────────────────────────────────────────────────────────────

describe('retry: business-failure loop exhaustion and error-path behavior', () => {
  it('when every retry attempt still looks like a business failure (isExceptionRequest), the loop exhausts and propagates the LAST attempt as-is', async () => {
    // Unlike Dio (which gives up and RESOLVES with the last, still-failing
    // attempt), axp's retry wraps an exhausted business-failure in a
    // synthetic AxiosError and REJECTS with it — the last attempt's data is
    // still reachable via error.response.data.
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => { attempts++; return { data: { code: 1, data: { attempt: attempts } } }; });
    api.use([retry({ max: 2, isExceptionRequest: (r) => (r.data as any).code !== 0 })]);

    let caught: any;
    try {
      await api.axios.get('/data', { retry: { max: 2, isExceptionRequest: (r: any) => r.data.code !== 0 } } as any);
      expect.unreachable();
    } catch (e) {
      caught = e;
    }
    expect(attempts).toBe(3);
    expect(caught.response.data.code).toBe(1);
  });

  it('a constructor-disabled retry never intercepts a network error at all', async () => {
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => { attempts++; return { status: 500, data: { code: 1, data: null } }; });
    api.use([retry({ max: 2, enable: false })]);
    await expect(api.axios.get('/data', { retry: 2 } as any)).rejects.toBeTruthy();
    expect(attempts).toBe(1);
  });

  it('unlike Dio\'s default retryIf (which excludes 404), axp\'s retry has no status-code selectivity — a 404 retries unconditionally up to max (see file doc)', async () => {
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => { attempts++; return { status: 404, data: { code: 1, data: null } }; });
    api.use([retry({ max: 2 })]);
    await expect(api.axios.get('/data', { retry: 2 } as any)).rejects.toBeTruthy();
    expect(attempts).toBe(3); // original + 2 retries — no retryIf gate to stop it
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('auth: authFailureFactory classification', () => {
  const factory = authFailureFactory('Authorization');

  it('with no token in the store: a 401 classifies as expired, a 403 as deny', () => {
    const tm = new FakeTokenManager(undefined);
    expect(factory(tm as any, { status: 401 })).toBe(AuthFailureAction.Expired);
    expect(factory(tm as any, { status: 403 })).toBe(AuthFailureAction.Deny);
  });

  it('carried header matching the store token classifies as refresh; a stale/mismatched one classifies as replay', () => {
    const tm = new FakeTokenManager('t0');
    expect(factory(tm as any, { status: 401, config: { headers: { Authorization: 't0' } } })).toBe(AuthFailureAction.Refresh);
    expect(factory(tm as any, { status: 401, config: { headers: { Authorization: 'old' } } })).toBe(AuthFailureAction.Replay);
  });

  it('no carried header at all classifies as replay (someone else already refreshed before this request even went out)', () => {
    const tm = new FakeTokenManager('t0');
    expect(factory(tm as any, { status: 401, config: {} })).toBe(AuthFailureAction.Replay);
  });

  it('a non-401/403 status classifies as Others', () => {
    const tm = new FakeTokenManager('t0');
    expect(factory(tm as any, { status: 500 })).toBe(AuthFailureAction.Others);
  });
});

describe('auth: additional realistic branches', () => {
  it('a second request arriving while a first request\'s refresh is already in flight awaits the SAME refresh, and is rejected the same way when it fails', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 401, data: { code: 1, data: null } }));
    const tm = new FakeTokenManager('t0');
    let refreshCalls = 0;
    api.use([auth({
      tokenManager: tm as any,
      onRefresh: async () => { refreshCalls++; await new Promise((r) => setTimeout(r, 20)); throw new Error('refresh failed'); },
      onAccessExpired: async () => {},
    })]);

    const [ra, rb] = await Promise.allSettled([
      api.axios.get('/data'),
      api.axios.get('/data'),
    ]);
    expect(ra.status).toBe('rejected');
    expect(rb.status).toBe('rejected');
    expect(refreshCalls).toBe(1); // single-flight refresh — second caller awaited the same one
  });

  it('a custom onAccessDenied callback is used (instead of falling back to onAccessExpired) when a protected request has no token', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: null } }));
    const tm = new FakeTokenManager(undefined);
    let denied = 0;
    let expired = 0;
    api.use([auth({
      tokenManager: tm as any,
      onRefresh: async () => {},
      onAccessExpired: async () => { expired++; },
      onAccessDenied: async () => { denied++; },
    })]);

    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    expect(denied).toBe(1);
    expect(expired).toBe(0);
  });

  it('a network-level error with no HTTP response at all is passed through, not misclassified', async () => {
    const { net, api } = mkApi();
    net.fallback(() => { throw new Error('ECONNREFUSED'); });
    const tm = new FakeTokenManager('t0');
    api.use([auth({ tokenManager: tm as any, onRefresh: async () => {}, onAccessExpired: async () => {} })]);
    await expect(api.axios.get('/data')).rejects.toBeTruthy();
  });

  it('a replay that ALSO fails hits the "already replayed once" guard and gives up immediately rather than refreshing again', async () => {
    // axios's own `.request()` re-merges a fresh config from defaults each
    // top-level call (mergeConfig produces a NEW object) — the REFRESHED
    // bag flag never survives across two SEPARATE `.request()` calls by an
    // external caller. It only persists across the PLUGIN's own internal
    // replay (`ctx.axios.request(config)` reusing the same, already-merged
    // config reference mid-chain), so the guard is only observable within
    // ONE top-level call whose replay also fails.
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => { attempts++; return { status: 401, data: { code: 1, data: null } }; });
    const tm = new FakeTokenManager('t0');
    let refreshCalls = 0;
    let expiredCalls = 0;
    api.use([auth({
      tokenManager: tm as any,
      onRefresh: async () => { refreshCalls++; tm.set('t1'); },
      onAccessExpired: async () => { expiredCalls++; },
    })]);

    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    expect(attempts).toBe(2); // original 401 + one replay, both fail
    expect(refreshCalls).toBe(1); // guard skipped a second refresh attempt
    expect(expiredCalls).toBe(1);
  });

  it('a custom onFailure callback can force the deny or expired action directly, regardless of the default classification', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ status: 401, data: { code: 1, data: null } }));
    const tm1 = new FakeTokenManager('t0');
    let denied = 0;
    api.use([auth({
      tokenManager: tm1 as any,
      onRefresh: async () => {},
      onAccessExpired: async () => {},
      onAccessDenied: async () => { denied++; },
      onFailure: () => AuthFailureAction.Deny,
    })]);
    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    expect(denied).toBe(1);
  });

  it('isProtected decides per-request whether auth applies at all', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: null } }));
    const tm = new FakeTokenManager(undefined);
    api.use([auth({
      tokenManager: tm as any,
      onRefresh: async () => {},
      onAccessExpired: async () => {},
      isProtected: (config) => config.url?.startsWith('/protected') ?? false,
    })]);

    const r = await api.axios.get('/public');
    expect(r.status).toBe(200);
    await expect(api.axios.get('/protected/x')).rejects.toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('cancel: cancelAll bookkeeping', () => {
  it('cancelAll() genuinely aborts an in-flight request and clears its own bookkeeping', async () => {
    // axios enforces `signal.aborted` in dispatchRequest's own
    // throwIfCancellationRequested — independent of whether the adapter
    // itself listens for it — so cancelAll() actually rejects the pending
    // call even though makeNetwork()'s fake adapter never checks the signal.
    const { net, api } = mkApi();
    const { cancelAll } = await import('../src/plugins/cancel');
    net.fallback(() => ({ data: { code: 0, data: null } }));
    api.use([cancel()]);

    const p = api.axios.get('/data', { latency: 200 } as any); // still in flight below
    await new Promise((r) => setTimeout(r, 10));
    const cancelled = cancelAll(api.axios, 'test');
    expect(cancelled).toBeGreaterThanOrEqual(1);
    const cancelledAgain = cancelAll(api.axios, 'test');
    expect(cancelledAgain).toBe(0); // already cleared, nothing left to report
    await expect(p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  });

  it.skip('re-dispatching the SAME config with an already-injected signal — axios\'s own mergeConfig produces a fresh internal config on every top-level .request() call, so an injected signal never survives across two separate calls by an external caller (same limitation hit by auth\'s REFRESHED guard, see that describe block); this can only be exercised via a plugin\'s OWN internal replay, not from test code', () => {});
});

describe.skip('log — no logging plugin exists in axp, see file doc', () => {});

// ───────────────────────────────────────────────────────────────────────────

describe('mock: mockUrl redirect path', () => {
  it('$shouldFallback: 404 or a non-cancel network error triggers fallback; a cancel or any other status does not', () => {
    expect($shouldFallback({ response: { status: 404 } as any })).toBe(true);
    expect($shouldFallback({ response: { status: 200 } as any })).toBe(false);
    expect($shouldFallback({ error: { code: 'ECONNREFUSED' } })).toBe(true);
    expect($shouldFallback({ error: { code: 'ERR_CANCELED' } })).toBe(false);
    expect($shouldFallback({})).toBe(false);
  });

  it('a successful mock-server response is returned directly, and a fallback-triggering one instead falls back to the real API', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/mockbase/data', () => ({ data: { code: 0, data: { v: 'mocked' } } }));
    net.on('GET', '/data', () => ({ data: { code: 0, data: { v: 'real' } } }));
    api.use([mock({ enable: true, mockUrl: '/mockbase' })]);

    const r1: any = await api.axios.get('/data', { mock: true } as any);
    expect(r1.data.data.v).toBe('mocked');

    const { net: net2, api: api2 } = mkApi();
    net2.on('GET', '/mockbase/data', () => ({ data: { code: 0, data: { v: 'mocked' } } }));
    net2.on('GET', '/data', () => ({ data: { code: 0, data: { v: 'real' } } }));
    api2.use([mock({ enable: true, mockUrl: '/mockbase', fallbackWhen: () => true })]);
    const r2: any = await api2.axios.get('/data', { mock: true } as any);
    expect(r2.data.data.v).toBe('real');
  });

  it('a mock server that errors outright falls back to the real API when fallbackWhen says so, and rejects otherwise', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/data', () => ({ data: { code: 0, data: { v: 'real' } } }));
    net.on('GET', '/deadmock/data', () => { throw new Error('ECONNREFUSED'); });
    api.use([mock({ enable: true, mockUrl: '/deadmock', fallbackWhen: () => true })]);
    const r1: any = await api.axios.get('/data', { mock: true } as any);
    expect(r1.data.data.v).toBe('real');

    const { net: net2, api: api2 } = mkApi();
    net2.on('GET', '/deadmock/data', () => { throw new Error('ECONNREFUSED'); });
    api2.use([mock({ enable: true, mockUrl: '/deadmock', fallbackWhen: () => false })]);
    await expect(api2.axios.get('/data', { mock: true } as any)).rejects.toBeTruthy();
  });

  it.skip('inline handler table (mock.add()/.remove()/.reset()) — no equivalent in axp, mockUrl-redirect only, see file doc', () => {});
});

// ───────────────────────────────────────────────────────────────────────────

describe('normalize', () => {
  it('a business failure (code !== 0) rejects with an ApiError carrying a structured ApiResponse', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 1, data: null, message: 'boom' } }));
    api.use([normalize()]);
    await expect(api.axios.get('/data')).rejects.toThrow('boom');
    try {
      await api.axios.get('/data');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as InstanceType<typeof ApiError>).response.code).toBe(1);
    }
  });

  it('a successful envelope passes through untouched — normalize does not unwrap (Core.dispatch does that unconditionally, independent of this plugin)', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 0, data: { v: 1 }, message: '' } }));
    api.use([normalize()]);
    const r = await api.axios.get('/data');
    expect(r.data).toEqual({ code: 0, data: { v: 1 }, message: '' });
  });

  it.skip('shouldNormalize override / ApiException.toString() — axp\'s normalize has no envelope-detection override, and ApiError\'s toString differs from Dio\'s ApiException, see file doc', () => {});
});
