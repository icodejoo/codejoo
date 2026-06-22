# @codejoo/axp

[中文](./README.zh-CN.md) | English

A typed, **plugin-based** HTTP client on top of `axios`. Wrap an axios instance,
bind your OpenAPI-derived schema (`model.PathRefs`) for end-to-end inference of
path / payload / response, and compose single-purpose plugins whose side-effects
are auto-tracked and reverted on eject.

```bash
npm i @codejoo/axp   # peer dep: axios
```

## Quick start

```ts
import axios from 'axios';
import { create, cache, retry, share, buildKey } from '@codejoo/axp';

const api = create<model.PathRefs>(axios.create({ baseURL: '/api' }), { debug: false });

// build-key feeds cache/share with a dedup key; install in the order you want them to run
api.use([buildKey(), cache({ expires: 30_000 }), share(), retry({ max: 2 })]);

const pets = await api.get('/pet/findByStatus')({ status: 'available' });   // → model.Pet[]
await api.post('/pet')({ name: 'lassie', photoUrls: [] });                  // → model.Pet
```

## Response shapes (chosen per call)

| call | returns |
| --- | --- |
| `get(path)(payload)` | **unwrapped** business data — the `data` of a `{ code, data, message }` envelope; non-envelope bodies pass through as-is |
| `get(path)(payload, { raw: true })` | the **whole envelope** `{ code, data, message }` |
| `get(path)(payload, { wrap: true })` | an `ApiResponse<R>` instance |

Verbs: `get` `post` `put` `patch` `delete` `head` `options`. Body verbs send
`payload` as `data`, others as `params`.

## Core API

`create<T = unknown>(axiosInstance = axios.create(), options?): Core<T>`

| `CoreOptions` | type | default | purpose |
| --- | --- | --- | --- |
| `debug` | `boolean` | `false` | verbose plugin/interceptor logging |
| `logger` | `PluginLogger` | `console.*` | log sink (`log`/`warn`/`error`) |

| `Core<T>` method | purpose |
| --- | --- |
| `use(plugin \| plugin[])` | install one/many (batch = single refresh); chainable |
| `eject(name \| plugin \| factory)` | uninstall by `.name`; reverts all tracked side-effects |
| `plugins()` | `readonly PluginRecord[]` snapshot |
| `extends(overrides?)` | derive a child `Core` (cloned defaults + same plugin set) |

**Ordering** is the caller's responsibility (no priority field): request
interceptors run LIFO, response interceptors FIFO, transformers in append order,
adapter = last-installed wins.

---

## Plugins

Every plugin takes `{ enable?: boolean }` (default `true`; `false` = not installed).
Tables below omit `enable` and list the rest. Request-level fields are set per call
in the dispatch `config` (e.g. `api.get(p)(payload, { cache: true })`).

### `buildKey(options?)` — compute a dedup/cache key onto `config.key`
| option | type | default | purpose |
| --- | --- | --- | --- |
| `fastMode` | `boolean` | `true` for `key:true`, `false` for object form | simple (`method+url`) vs deep (`+params+data`) |
| `ignoreKeys` | `any[]` | — | keys exempt from empty-value filtering (deep) |
| `ignoreValues` | `any[]` | — | values exempt from empty-value filtering (deep) |
| `sample` | `boolean` | `false` | sample strings > 64 chars instead of full hash |
| `before` / `after` | `(config) => any` | — | hooks run before/after key generation |

Request field `key`: `true` \| `'deep'` \| `number` \| `string` \| `IBuildKeyObject` \| `(config) => …`. Also exports `$key`.

### `cache(options?)` — TTL response cache (adapter-level short-circuit)
| option | type | default | purpose |
| --- | --- | --- | --- |
| `expires` | `number` (ms) | `60_000` | default TTL |
| `key` | `(config) => string \| undefined` | — | key source; falls back to `config.key` |
| `clone` | `'shallow' \| 'deep' \| (data) => any` | — (shared ref) | hit-return copy strategy |

Request field `cache`: `false` (off) \| `true` (on, **shared reference** — treat as read-only) \| `{ expires?, key?, clone? }`. `clone:'deep'` uses `structuredClone` (throws if unavailable; pass a function for non-cloneable data). Also exports `removeCache(ax, key)`, `clearCache(ax)`.

### `share(options?)` — dedup/debounce/merge concurrent same-key requests
| option | type | default | purpose |
| --- | --- | --- | --- |
| `policy` | `'start'\|'end'\|'race'\|'retry'\|'none'` | `'start'` | dedup strategy |
| `interval` | `number` (ms) | `0` | gap between retries (`retry` policy) |
| `retries` | `number` | `3` | max retries (`retry` policy) |

Keys off `config.key` (install `buildKey` first). Request field `share`: `false` \| `true` \| a policy string \| `{ policy?, interval?, retries? }` \| `(config) => …`.

### `retry(options?)` — re-issue failed requests
| option | type | default | purpose |
| --- | --- | --- | --- |
| `max` | `number` | `0` | max retries (0 = off) |
| `isExceptionRequest` | `(response) => boolean` | — | treat a "successful" response as a failure to retry |

Request field `retry`: `number` \| `{ max?, isExceptionRequest? }`. Note: a full-chain re-issue does **not** re-trigger adapter plugins (cache/share/loading/mock) consumed on the first attempt.

### `loading(options?)` — global request-count loading toggle
| option | type | default | purpose |
| --- | --- | --- | --- |
| `loading` | `(visible: boolean) => any` | — | fallback toggle callback |

Counts all participating requests: `0→1` calls `loading(true)`, `N→0` calls `loading(false)`. Request field `loading`: `false` (skip) \| `true` (use plugin callback) \| `(visible) => any` (per-request override).

### `auth(options)` — token guard + single-flight refresh
| option | type | default | purpose |
| --- | --- | --- | --- |
| `tokenManager` | `ITokenManager` | **required** | token source |
| `onRefresh` | `(tm, resp) => any` | **required** | refresh impl; `false`/throw = failed; concurrent calls share one run |
| `onAccessExpired` | `(tm, resp) => void` | **required** | expiry callback (Expired / refresh-fail / replay-then-fail); `tm.clear()` already done |
| `methods` | `string \| string[]` | `'*'` | protected method whitelist (∩ `urlPattern`) |
| `urlPattern` | `string \| string[]` | `'*'` | protected URL patterns (URLPattern; `!` = negate) |
| `isProtected` | `(config) => boolean \| void` | — | functional protection check (above methods/url) |
| `onFailure` | `(tm, resp) => AuthFailureAction \| void` | `DEFAULT_ON_AUTH_FAILURE` | failure router → 5 actions |
| `onAccessDenied` | `(tm, resp) => void` | → `onAccessExpired` | denied-access callback |
| `ready` | `(tm, config) => void` | inject `Authorization` | attach credentials before send |
| `accessDeniedCode` | `string` | `'ACCESS_DENIED'` | business code for synthetic denied response |

Request field `protected`: `boolean` \| `(config) => boolean \| void` (per-call override). Also exports `AuthFailureAction` (`Refresh`/`Replay`/`Deny`/`Expired`/`Others`), `authFailureFactory(headerName?)`, `DEFAULT_ON_AUTH_FAILURE`, `ACCESS_DENIED_CODE`. The default router is HTTP-status based (401/403); envelope-code projects supply their own `onFailure`.

**Refresh semantics (default).** Refresh is single-flight (concurrent failures share one `onRefresh`); new protected requests during the window are suspended; non-protected requests pass through untouched. Each request gets **at most one** refresh-and-replay, then `onAccessExpired` — so it always converges (no loop, no storm). On a 401:

- **carried token ≠ current** (a stale in-flight request) → **replay** with the current token, *no* refresh.
- **carried token = current** → the request still has its one refresh budget → **refresh once, then replay**; if it still 401s → expired. This deliberately keeps the recovery path open for the case where the token was rotated elsewhere (another tab/device) and a fresh refresh can still succeed.

If your backend contract is instead "a 401 on a just-refreshed token means the session is dead, never refresh again", make it expire immediately via a custom `onFailure`:

```ts
import { AuthFailureAction, DEFAULT_ON_AUTH_FAILURE } from '@codejoo/axp';

onFailure: (tm, resp) => {
  const carried = (resp.config?.headers as any)?.Authorization;
  if (resp.status === 401 && carried === tm.accessToken) return AuthFailureAction.Expired; // strict: no second refresh
  return DEFAULT_ON_AUTH_FAILURE(tm, resp);
}
```

### `mock(options?)` — route to a mock server, fall back to real on miss
| option | type | default | purpose |
| --- | --- | --- | --- |
| `mock` | `boolean` | `false` | mock all requests by default |
| `mockUrl` | `string` | — | mock server base URL |
| `fallbackWhen` | `(info) => boolean` | 404 / unreachable | "mock missing" predicate → fall back to real |

Enable defaults to `false` (gate with `import.meta.env.DEV`). Request field `mock`: `false` \| `true` \| `{ mock?, mockUrl?, fallbackWhen? }`.

### `normalizeRequest(options?)` — strip empty params/data fields
| option | type | default | purpose |
| --- | --- | --- | --- |
| `predicate` | `(kv: [key, value]) => boolean` | drops `null`/`undefined`/`NaN`/blank string | return `true` to drop a field |
| `ignoreKeys` | `string[]` | — | keys kept even if predicate drops |
| `ignoreValues` | `any[]` | — | values kept even if predicate drops |

Request field `filter`: `false`/falsy (skip) \| `true` \| `INormalizeRequestOptions` \| `(config) => …`. (The request-level trigger stays `filter` — `normalize` is taken by `normalizeResponse`.)

### `normalizeResponse(options?)` — strict business-success check
On `ApiResponse.fromResponse(res).successful === false`, rejects an `ApiError` (carrying a structured `ApiResponse`); on the error path attaches `error.api`. Does not rewrite successful `response.data`. Option: `nullable?: boolean`.

### `repath(options?)` — substitute path variables from params/data
| option | type | default | purpose |
| --- | --- | --- | --- |
| `pattern` | `RegExp` | matches `{id}` / `:id` / `[id]` | placeholder matcher |
| `removeKey` | `boolean` | `true` | delete the consumed key from params/data after substitution |

Substitutes `/{id}` / `:id` / `[id]` from `params` (then `data`). No request-level field.

### `envs(rules)` — pick env config at install time
`rules: { rule: () => boolean; config: CreateAxiosDefaults }[]`. The first rule whose `rule()` is truthy shallow-merges its `config` into `axios.defaults`. Zero runtime overhead (no interceptors).

### `cancel(options?)` — auto-inject AbortController per request
Injects a `signal` for requests without one (respects user-provided `signal`/`cancelToken`). Exports `cancelAll(ax, reason?)` to abort all in-flight requests of an instance (returns the count aborted).

---

## Model objects

**`ApiResponse<T>`** — `{ status, code, message, data, successful }`.
`ApiResponse.fromResponse(res)` builds one defensively (null-safe).
`ApiResponse.isSuccessful(status, code)` is the success hook (default: HTTP 2xx and
`code` ∈ `{0, '0000'}`, or no `code` → pure HTTP); reassign to customize.

**`ApiError<T>`** — `Error` with `.response: ApiResponse<T>`; what `normalizeResponse` rejects on business failure.

**`TokenManager`** (`implements ITokenManager`) — `canRefresh`, `accessToken`
(getter returns `Bearer <token>`; setter stores the bare token), `refreshToken`,
`set(access?, refresh?)`, `clear()`. Persists bare tokens to `localStorage` (SSR-safe).

## Authoring a plugin

```ts
import type { Plugin } from '@codejoo/axp';

const logging: Plugin = {
  name: 'logging',                       // unique id; used by eject
  install(ctx) {
    ctx.request((cfg) => { ctx.logger.log('→', cfg.method, cfg.url); return cfg; });
    ctx.response((res) => res, (err) => Promise.reject(err));
    // ctx.adapter / ctx.transformRequest / ctx.transformResponse / ctx.cleanup
    return () => {/* optional: release non-axios resources */};
  },
};
```

Everything registered through `ctx` is tracked and reverted on `eject` — no manual
cleanup. For state, close over it in `install`.

## Build & test

- `npm test` / `npx vitest run` — unit + integration suites (`test/**`).
- `npm run build` — `vp pack` → `dist/index.mjs`, `dist/index.min.js`, `dist/index.d.mts`.
- `npm run e2e` — Playwright-driven real-browser suite (`e2e/`).
