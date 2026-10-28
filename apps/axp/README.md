# @codejoo/axp

[中文](./README.zh-CN.md) | English

Plugin-based HTTP client on top of `axios`. `Axp.install` wires plugins onto
any `AxiosInstance`; `Axp.create`/`Core` are an optional typed dispatch layer
on top — the type system is entirely yours to opt into, never required.

```bash
npm i @codejoo/axp   # peer dep: axios
```

Entry points: `@codejoo/axp` (unbundled ESM, shares module state with the
per-plugin subpaths `@codejoo/axp/cache`, `/cancel`, `/auth`, … — mixing the
root import and subpaths is safe) and `@codejoo/axp/min` (a single minified
bundle with its **own** module copy — don't mix it with the root or subpaths).
Typed inference needs TypeScript ≥ 5.4.

## Quick start

```ts
import axios from 'axios';
import { Axp, axpKey, axpCache, axpShare, axpRetry } from '@codejoo/axp';

const axiosInstance = axios.create({ baseURL: '/api' });

Axp.install(axiosInstance, {
  key: axpKey(),
  cache: axpCache({ expires: 30_000 }),
  share: axpShare(),
  retry: axpRetry({ max: 2 }),
});

const res = await axiosInstance.get('/pet/findByStatus', { params: { status: 'available' }, key: true, cache: true });
```

Want typed `path`/`payload`/`response` inference instead of plain `axios` calls?
Wrap the same instance in `Axp.create` (see below) — `Axp.install` works
identically either way, since it only ever needs a raw `AxiosInstance`.

## `Axp.create` — optional typed dispatch layer

```ts
import { Axp } from '@codejoo/axp';

const api = Axp.create<MySchema>(axios.create({ baseURL: '/api' }));
const pets = await api.get('/pet/findByStatus')({ status: 'available' });  // → MySchema['get']['/pet/findByStatus'][0]
await api.post('/pet')({ name: 'lassie', photoUrls: [] });
```

`Axp.create<T = unknown>(axiosInstance = axios.create(), options?): Core<T>`.
`T` can be **any** type shaped like `MethodSchema` (see `src/types.ts`) —
hand-written, your own codegen, `@codejoo/openapi2lang`'s emitted type,
whatever you want; axp only checks the structural shape against the schema's
actual keys (an `interface` without an index signature works), there's no
required global namespace. To add paths codegen hasn't caught up with, copy
`types/local/example.d.ts.template` — it extends `MethodRefs` into a
`LocalMethodRefs` you pass as `T`. Omit `T` (or the whole `Axp.create` wrapper) for an untyped
client — every path is then just `string`.

Each HTTP verb (`get` `post` `put` `patch` `delete` `head` `options`) is called
as `api.<verb>(path, methodConfig?)(payload?, callConfig?)`. Body verbs send
`payload` as `data`, others as `params`.

| call | returns |
| --- | --- |
| `verb(path)(payload)` | unwrapped business data (the `data` of a `{ code, data, message }` envelope; non-envelope bodies pass through as-is) |
| `verb(path)(payload, { raw: true })` | the whole envelope `{ code, data, message }` |
| `verb(path)(payload, { wrap: true })` | an `AxpResponse<R>` instance (a non-envelope body lands in its `data` as-is) |

`api.axios` is the underlying `AxiosInstance` — pass it to `Axp.install`.
`api.extends(overrides?)` derives a child `Core` with cloned `axios.defaults` +
`overrides` merged on top; it does not carry over plugins (the child gets the
parent's unwrapped base adapter, so no cache/loading/mock state leaks across) —
call `Axp.install` again on `child.axios` if the derived instance needs them.

## `Axp.install` — plugin orchestration

```ts
const handle = Axp.install(axiosInstance, { key: axpKey(), cache: axpCache() });
```

Takes a plain `AxiosInstance` — `axios.create()`'s return value, or
`api.axios` if you also used `Axp.create`. Installs the given plugins onto it
in a fixed order and returns an `AxpHandle`:

| member | signature | purpose |
| --- | --- | --- |
| `axios` | `AxiosInstance` | the instance passed in |
| `plugins` | `readonly Plugin[]` | snapshot, current order |
| `plugin(name)` | `(string) => Plugin \| undefined` | look up by `.name` |
| `dispose()` | `() => void` | uninstall everything this handle tracks |
| `prepend(p)` / `append(p)` | `(Plugin) => void` | install one more, before/after the tracked set |
| `insertBefore(anchor, p)` / `insertAfter(anchor, p)` | `(Plugin, Plugin) => void` | slot relative to a tracked plugin; throws if `anchor` isn't tracked |

```ts
import { Axp, axpKey, axpCache, axpLogger } from '@codejoo/axp';

const handle = Axp.install(axiosInstance, { key: axpKey(), cache: axpCache() });

handle.plugin('axp:cache');           // → the axpCache() Plugin object passed in above
handle.append(axpLogger({ debug: true }));       // adds after everything this handle tracks
handle.prepend(myOwnPlugin);                     // adds before everything this handle tracks

const cachePlugin = handle.plugin('axp:cache')!;
handle.insertBefore(cachePlugin, myOwnPlugin2);  // slot relative to a tracked plugin

handle.dispose();                     // ejects every plugin this handle tracks
```

`AxpPlugins` slots: `logger` `envs` `key` `filter` `repath` `auth` `cancel`
`retry` `notify` `normalize` `cache` `share` `mock` `loading`. Omit a slot (or
pass a falsy value) to skip that plugin.

Adapter-level plugins (`cache` `share` `mock` `loading`) each occupy one layer
of an adapter chain; layers can be removed in any order — disposing one handle
never strips or resurrects another handle's layers.

---

## Plugins

Every plugin takes `{ enable?: boolean }` (default `true`). Tables below omit
`enable`. "Request field" is set per call, e.g. `api.get(p)(payload, { cache: true })`.

### `axpLogger(options?)`
Turns on debug logging for every other plugin.

| option | type | default |
| --- | --- | --- |
| `debug` | `boolean` | `false` |
| `logger` | `PluginLogger` (`log`/`warn`/`error`) | `console` |

```ts
axpLogger({ debug: true })
```

### `axpKey(options?)`
Computes a dedup/cache key onto `config.key`. Feeds `axpCache`/`axpShare`.

| option | type | default |
| --- | --- | --- |
| `fastMode` | `boolean` | `true` for `key:true`, `false` for object form |
| `ignores` | `any[]` | — (exempt these key names or values from empty-value filtering; mirrors dioman's `DiomanKey.ignores`) |
| `sample` | `boolean` | `false` (sample strings > 64 chars) |
| `before` / `after` | `(config) => any` | — |
| `scope` | `string \| number \| (config) => string \| number \| null \| undefined` | — (mixed into every key so caches/shares never cross accounts/tenants) |

`Date` and `URLSearchParams` hash by content. Values that can't be fingerprinted
reliably (`FormData`, `Blob`, `Map`, `Set`, class instances without enumerable
fields) yield **no key** — the request is then neither cached nor shared, a miss
beats a false hit.

Request field `key`: `true` \| `'deep'` \| `number` \| `string` \| `IKeyObject` \| `(config) => …`.

```ts
axpKey({ fastMode: false })
api.get('/list')(undefined, { key: true })
```

### `axpCache(options?)`
TTL response cache, adapter-level short-circuit (no HTTP on hit).

| option | type | default |
| --- | --- | --- |
| `expires` | `number` (ms) | `60_000` |
| `key` | `(config) => string \| undefined` | falls back to `config.key` |
| `clone` | `'shallow' \| 'deep' \| (data) => any` | — (shared reference) |
| `max` | `number` | `500` — LRU-evicted beyond this; expired entries are swept on every write (`Infinity` = unbounded) |
| `shouldCache` | `(response) => boolean` | skips non-2xx and business-failure envelopes (same success rule as `axpNormalize`) |

Request field `cache`: `false` \| `true` \| `{ expires?, key?, clone?, shouldCache? }`. Also
exports `removeCache(ax, key)`, `clearCache(ax)`.

The cache stores the adapter's raw response and hands every hit a fresh shell,
so `transformResponse` runs exactly once per hit. A slower, older response never
overwrites a newer one. `clearCache` also stops requests already in flight from
writing back — call it on logout/account switch (or set `axpKey({ scope })`).
The plugin does **not** clear on token refresh: same user, cache still valid.

```ts
axpCache({ expires: 30_000 })
api.get('/list')(undefined, { key: true, cache: true })
removeCache(api.axios, 'some-key')
clearCache(api.axios)
```

### `axpShare(options?)`
Dedup/debounce/merge concurrent requests with the same `config.key`.

| option | type | default |
| --- | --- | --- |
| `policy` | `'start' \| 'end' \| 'race' \| 'none'` | `'start'` |

Request field `share`: `false` \| `true` \| a policy string \| `{ policy? }` \| `(config) => …`.

Every caller keeps its own `signal`/`cancelToken`/`timeout`: canceling a follower
rejects just that follower immediately, the shared request keeps going. On
failure each caller gets its own error object whose `config` is its own.

```ts
axpShare({ policy: 'start' })
api.get('/list')(undefined, { key: true, share: true })
```

### `axpRetry(options?)`
Waits `delay`, then resends — up to `max` times — on failure or a response judged a business exception. Each resend is a single **attempt**: it reuses the original pre-`transformRequest` body (custom transforms run once per attempt, never stacked), passes through `axpAuth`'s attempt hook (fresh token injected; a 401 mid-retry refreshes and replays), and never re-enters the rest of the plugin chain — notify/normalize fire once per logical request, and an auth replay doesn't double the retry budget.

| option | type | default |
| --- | --- | --- |
| `max` | `number` | `0` (off) |
| `methods` | `string[]` | `['get','put','head','delete','options','trace']` — a hard veto, `shouldRetry` can't override it |
| `shouldRetry` | `(response?, err?) => boolean \| undefined` | — (no default; an exact `true`/`false` wins, `undefined` falls through to `statusCodes`) |
| `statusCodes` | `number[]` | `[408, 429, 500, 502, 503, 504]` |
| `delay` | `number \| (current, max, response?, err?) => number \| false \| void \| null` | `3000` (a non-number function return counts as `0`) |
| `jitter` | `true \| (delay: number) => number` | — (no jitter) |
| `delayMax` | `number` | `Infinity` |
| `respectRetryAfter` | `boolean` | `true` |
| `afterStatusCodes` | `number[]` | `[413, 429, 503]` — only these statuses trust a `Retry-After` header |
| `retryAfterMax` | `number` | `Infinity` |

Request field `retry`: `number` (max retries) \| `false` (disable, highest-priority veto) \| `true` (respect plugin defaults) \| `IRetryOptions` (per-request override of any field above, plus `enable: false` as an alternative to `false`).

Priority, each level can veto early: (1) `retry: false` / `{ enable: false }` → never retry; (2) `methods` whitelist → a method outside it is never retried, even if `shouldRetry` says otherwise; (3) `shouldRetry?.(response?, err?) ?? statusCodes.includes(status) ?? false`.

While waiting, the delay listens on `config.signal` — canceling the request (e.g. via `axpCancel`) stops the wait immediately instead of idling until the timer fires. A response's `Retry-After` header (seconds, or an HTTP-date) wins over the computed `delay` when its status is covered by `afterStatusCodes`; the result is capped by `retryAfterMax` and skips `jitter`/`delayMax` (those only apply to the plugin's own computed delay).

```ts
axpRetry({ max: 3, statusCodes: [500, 502, 503, 504], jitter: true, delayMax: 10_000 })
api.get('/flaky')(undefined, { retry: 3 })
api.get('/flaky')(undefined, { retry: { max: 2, shouldRetry: (r) => r?.data?.code !== 0 } })
api.get('/flaky')(undefined, { retry: false }) // never retry this one call
```

### `axpNotify(options)`
Stringifies a response/error and passes it to a callback (e.g. a toast).

| option | type | default |
| --- | --- | --- |
| `notify` | `(message: string) => void` | **required** |
| `stringify` | `(data, message, status, config) => string` | **required** (return `''` to skip) |

```ts
axpNotify({
  notify: (msg) => toast.error(msg),
  stringify: (data, message, status) => (status >= 400 ? message : ''),
})
```

### `axpLoading(options?)`
Global request-count loading toggle.

| option | type | default |
| --- | --- | --- |
| `loading` | `(visible: boolean) => any` | — |
| `delay` | `number` | `0` — defers showing past a 0→1 edge; canceled outright if the count falls back to 0 first (a fast request never shows loading at all) |
| `delayClose` | `number` | `0` — defers hiding past a 1→0 edge; canceled if a new request bumps the count back to 1 first (back-to-back requests don't flicker) |

Counts **logical** requests: retries and auth replays of one request share a
single show/hide pair, so the spinner doesn't flicker between attempts. A
throwing `loading` callback is isolated (the request and the counter are
unaffected); disposing the plugin cancels pending delayed callbacks.

Request field `loading`: `false` (skip) \| `true` \| `(visible) => any` \| `{ enable?, loading?, delay?, delayClose? }` (per-field override; `enable: false` is equivalent to the top-level `false`).

```ts
axpLoading({ loading: (v) => setSpinner(v), delay: 200, delayClose: 200 })
api.get('/list')(undefined, { loading: true })
api.get('/quiet')(undefined, { loading: { delay: 0 } }) // this call skips the anti-flicker delay
```

### `axpAuth(options)`
Token guard + single-flight refresh-and-replay on 401/403.

| option | type | default |
| --- | --- | --- |
| `tokenManager` | `ITokenManager` | **required** |
| `onRefresh` | `(tm, resp) => any` | **required** (`false`/throw = failed) |
| `onAccessExpired` | `(tm, resp) => void` | **required** |
| `methods` / `urlPattern` | `string \| string[]` | `'*'` |
| `isProtected` | `(config) => boolean \| void` | — |
| `onFailure` | `(tm, resp) => AuthFailureAction \| void` | `DEFAULT_ON_AUTH_FAILURE` |
| `onAccessDenied` | `(tm, resp) => void` | → `onAccessExpired` |
| `ready` | `(tm, config) => void` | injects `Authorization` header |
| `accessDeniedCode` | `string` | `'ACCESS_DENIED'` |

Request field `protected`: `boolean` \| `(config) => boolean \| void`.

Refresh-and-replay keeps the original request's cancellation: `cancelAll()`
during a refresh cancels the pending replay too. A replay only re-runs the auth
step — retry/notify/normalize still run once. Refresh is skipped while
`tokenManager.canRefresh` is `false`; the plugin sets it to `false` when the
session expires, and your login flow sets it back to `true`.

Also exports `AuthFailureAction` (a const object + same-name type), `authFailureFactory(headerName?)`,
`DEFAULT_ON_AUTH_FAILURE`, `ACCESS_DENIED_CODE`, `TokenManager`.

```ts
axpAuth({
  tokenManager: new TokenManager(),
  urlPattern: ['/api/*', '!/api/public/*'],
  onRefresh: (tm) => refreshToken(tm),
  onAccessExpired: (tm) => redirectToLogin(),
})
```

### `axpMock(options?)`
Routes to a mock server; falls back to the real one when the mock misses.

| option | type | default |
| --- | --- | --- |
| `mock` | `boolean` | `false` (mock all requests by default) |
| `mockUrl` | `string` | — |
| `fallbackWhen` | `(info) => boolean` | 404 / unreachable |

Request field `mock`: `false` \| `true` \| `{ mock?, mockUrl?, fallbackWhen? }`. A per-request value survives retries.

```ts
axpMock({ enable: import.meta.env.DEV, mockUrl: 'http://localhost:4000' })
api.get('/pet/1')(undefined, { mock: true })
```

The mock probe request bypasses `cache` and `share`: it neither reads nor writes the cache and is never merged with concurrent requests. Only the real request issued after a fallback goes through `cache`/`share`. So N same-key mock requests always fire N probes, and a mocked response is never cached.

### `axpFilter(options?)`
Strips empty `params`/`data` fields before send.

| option | type | default |
| --- | --- | --- |
| `predicate` | `(kv: [key, value]) => boolean` | drops `null`/`undefined`/`NaN`/blank string; an entry is dropped only when it returns exactly `true` |
| `ignoreKeys` / `ignoreValues` | `array` | — |

Request field `filter`: `false` \| `true` \| `IFilterOptions` \| `(config) => …`.

```ts
axpFilter()
api.get('/search')(undefined, { filter: true, params: { q: 'x', page: '' } })
```

### `axpNormalize(options?)`
Rejects with `ApiError` when `AxpResponse.fromResponse(res).successful === false`.

| option | type | default |
| --- | --- | --- |
| `nullable` | `boolean` | — |

Request field `normalize`: `false` \| `true` \| `{ enable? }` \| `(config) => …` — turn it off for one call.

```ts
axpNormalize()
```

### `axpRepath(options?)`
Substitutes `{id}` / `:id` / `[id]` path placeholders from `params` (then `data`).
Only the pathname is touched (query string, hash and `host:port` are left alone);
a placeholder used twice is filled twice; values are `encodeURIComponent`-encoded
per path segment.

| option | type | default |
| --- | --- | --- |
| `pattern` | `RegExp` | matches `{id}` / `:id` / `[id]` |
| `removeKey` | `boolean` | `true` (delete the consumed key after substitution) |

```ts
axpRepath()
api.get('/pet/:id')(undefined, { params: { id: 5 } })  // → GET /pet/5
```

### `axpEnvs(rules)`
Picks env config at install time (no interceptors).

```ts
axpEnvs([
  { rule: () => import.meta.env.DEV, config: { baseURL: 'http://dev' } },
  { rule: () => import.meta.env.PROD, config: { baseURL: 'http://prod' } },
])
```

### `axpCancel(options?)`
Auto-injects an `AbortController` per request (skips requests with their own
`signal`/`cancelToken`). Exports `cancelAll(ax, reason?) => number`.

```ts
axpCancel()
cancelAll(api.axios, 'navigated away')
```

---

## Model objects

**`AxpResponse<T>`** — `{ status, code, message, data, successful }`.
`AxpResponse.fromResponse(res)` builds one defensively (null-safe).
`AxpResponse.isSuccessful(status, code)` is the success hook — reassign to customize.

**`ApiError<T>`** — `Error` with `.response: AxpResponse<T>`; what `axpNormalize` rejects with.

**`TokenManager`** (`implements ITokenManager`) — `canRefresh`, `accessToken`
(getter returns `Bearer <token>`), `refreshToken`, `set(access?, refresh?)`,
`clear()`. Persists bare tokens to `localStorage`.

## Authoring a plugin

```ts
import type { Plugin } from '@codejoo/axp';
import { pluginLog } from '@codejoo/axp';

const logging: Plugin = {
  name: 'logging',
  install(axios) {
    const id = axios.interceptors.request.use((cfg) => {
      pluginLog(cfg, '→', cfg.method, cfg.url);
      return cfg;
    });
    return () => { axios.interceptors.request.eject(id); };  // omit if nothing to undo
  },
};
```

Request interceptors run LIFO (last-registered runs first), response
interceptors run FIFO (first-registered runs first) — plain `axios` semantics.

## Build & test

- `npm test` / `npx vitest run` — unit + integration suites (`test/**`).
- `npm run build` — `dist/esm/**` (unbundled ESM + `.d.mts`, root and per-plugin subpaths) and `dist/index.min.js` (`./min`).
- `npm run e2e` — Playwright-driven real-browser suite (`e2e/`) against the local mock server.
- `npm run accept` — black-box acceptance against [api-ws-demo testkit](https://github.com/icodejoo/api-ws-demo/tree/main/testkit): real HTTP server + network-condition proxy, scenario × network × response style × adapter.
