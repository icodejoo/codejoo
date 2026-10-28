# @codejoo/axp

[中文](./README.zh-CN.md) | English

A plugin-based HTTP client on top of `axios`. Retries, auth, caching, de-duplication, mocks and loading are all plugins, layered around each request in a fixed order of stages. Successes, failures and thrown errors are the same kind of object: the normalized response `IAxpResponse`.

Upgrading from the old API (`Axp.install` / `Axp.create`)? See the [migration guide](docs/guides/migrating-to-pipeline.md).

```bash
npm i @codejoo/axp   # peer dep: axios
```

Entry points:
- `@codejoo/axp`: unbundled ESM. Plugin subpaths (`@codejoo/axp/retry`, `@codejoo/axp/cache`, ...) share one module instance with the root entry, so mixing them is fine.
- `@codejoo/axp/min`: a single minified file with **its own copy** of the module. Don't mix it with the root entry or the subpaths.

Typed inference needs TypeScript ≥ 5.4.

## Quick start

```ts
import axios from 'axios';
import { createAxp, axpRepath, axpRetry, axpAuth, axpCache, TokenManager } from '@codejoo/axp';
import type { Schema } from './api-schema'; // your endpoint types, same shape as the old MethodSchema

const api = createAxp<Schema>({
  axios: axios.create({ baseURL: '/api' }),
  plugins: [
    axpRepath(),                              // fills {id} in paths; active once installed
    axpRetry({ max: 2 }),
    axpAuth({
      tokenManager: new TokenManager(),
      onRefresh: (r, tm) => refreshToken(tm), // return false or throw to fail the refresh
      onAccessExpired: () => redirectToLogin(),
    }),
    axpCache({ expires: 30_000 }),
  ],
});

// Typed call: a success gives you the business data directly
const pet = await api.get('/pet/{id}')({ id: 1 });                                  // Pet
// Caching is opted in per request
const list = await api.get('/pet/findByStatus')({ status: 'available' }, { cache: true });
```

If you use a custom response type `R`, write both `S` and `R` explicitly: TypeScript doesn't do partial inference, so `S` alone can't infer `R`. Without `S`, paths fall back to `string`.

## Return shape and error handling

Two switches decide what a call returns: `wrap` and `throws`.

| Call | Success | Failure |
| --- | --- | --- |
| default | returns `data` | `throw r`, where `r` is an `IAxpResponse` |
| `{ wrap: true }` | returns `WithData<R, D>`: the same shape as the response, with `data` typed as the business type | same, thrown |
| `{ throws: false }` | returns `WithData<R, D>` | nothing is thrown; resolves with an `R` whose `ok` is `false` |

A failure is thrown as a plain object, not an `Error`. By default it has no `stack`; turn on `debug` to attach the call site. Program bugs (an exception from middleware, a user callback, or an interceptor that isn't an axios error) are not treated as request failures: they are rethrown as-is, and `throws: false` doesn't swallow them.

```ts
// Default: a failure you catch is an IAxpResponse; real bugs are rethrown
try {
  await api.post('/pet')(body);
} catch (e) {
  if (api.isResponse(e)) toast(e.message);   // an expected failure
  else throw e;                              // a bug
}

// throws: false: failures resolve too; check ok
const res = await api.post('/pet')(body, { throws: false });
if (!res.ok) toast(res.message);

// wrap: true: when you need the raw response
const out = await api.get('/pet/{id}')({ id: 1 }, { wrap: true });
out.data;   // Pet
out.raw;    // the original AxiosResponse (escape hatch)
```

Fields of `IAxpResponse`:

| Field | Description |
| --- | --- |
| `ok` | Success check; the one extension point, see the next section |
| `kind` | Category, see the table below |
| `status` | Logical status. Read this for 401, 403 and 5xx checks. In the default implementation, an HTTP 2xx response with a numeric business code in 400–599 gets that code as its `status` |
| `httpStatus` | Raw HTTP status; `0` when there was no response |
| `code` / `message` / `data` | Business code, message and data. `code` is `undefined` for non-envelope responses |
| `reason` | Finer reason, e.g. `expired`, `denied`, `unauthenticated` for auth failures |
| `request` | The request that was actually sent. For share or cache hits, the one that was sent |
| `stack` | Only present when `debug` is on and the failure is thrown, see below |
| `raw` | The original `AxiosResponse` |
| `error` | The original exception; the stack of a network error lives here |

Possible `kind` values:

| kind | Meaning |
| --- | --- |
| `ok` | Success |
| `http` | Non-2xx |
| `biz` | HTTP 2xx, but the business check failed |
| `network` | Network error |
| `timeout` | Timed out |
| `cancel` | Cancelled (`cancelAll` or `signal`) |
| `parse` | Response could not be parsed. With `expectJson` on, a 2xx came back as unparsed JSON text |
| `auth` | Auth failure; look at `reason` for details |
| `internal` | Internal wrapper for a program bug. The original exception is rethrown when the call settles, so you normally never see this |

Three related helpers:

- `api.isResponse(e)`: tells an expected failure apart from a program bug, and narrows the type to this client's `R`. It checks the same thing as `isAxpResponse(e)`.
- `createAxp({ reject })`: an expected failure goes through this function before it is thrown. The default returns it unchanged. If you use a library that needs an `Error` (Sentry, TanStack Query, ...), wrap it here:

  ```ts
  createAxp({ reject: (r) => Object.assign(new Error(r.message), { response: r }) });
  ```

- `debug`: when on, a thrown failure carries the `stack` of the call site where the request was started (with `throws: false` nothing is thrown, so there is none). It is only recorded in debug mode, so production has no extra cost.

`throws` is a per-request option that defaults to `true`; there is no client-level default, because the return type could not reflect it honestly.

## Custom responses

The default implementation is `AxpResponse`. To add fields or change the rule, subclass it and override the `ok` or `status` getter. `kind` follows `ok` automatically.

```ts
import { AxpResponse, axpResponse, axpRetry, createAxp } from '@codejoo/axp';

class MyResponse<D = unknown> extends AxpResponse<D> {
  traceId = '';
  get ok() { return this.httpStatus < 300 && this.code === 200; }   // our success code is 200
  get status() { return this.code === 'TOKEN_EXPIRED' ? 401 : super.status; }
}

const response = axpResponse<MyResponse>({
  create: (init, raw) => Object.assign(new MyResponse(init), { traceId: raw?.headers['x-trace-id'] ?? '' }),
});

const api = createAxp<Schema, MyResponse>({
  response,
  plugins: [axpRetry({ shouldRetry: (r) => r.traceId !== '' })],
});
```

Notes:

- `ok` and `status` are only evaluated when a response arrives. For failures without a response, such as network errors, the factory sets `ok: false`, `kind` and `status` directly, so your override only needs to look at a real response.
- When `R` is not `AxpResponse`, the `response` option of `createAxp` is required.
- You can skip subclassing and have `create` return a plain object with extra fields. The kernel adds the brand, and `isAxpResponse` still recognizes it.

Options of the default factory `axpResponse(options?)`:

| Option | Default | Description |
| --- | --- | --- |
| `envelope` | `{ code: 'code', data: 'data', message: 'message' }` | Envelope field names. `false` turns envelope detection off |
| `expectJson` | `false` | A declared JSON body that fails to parse is classified as `parse` |
| `create(init, raw?)` | `new AxpResponse(init)` | Extension point; return a subclass or an object with extra fields |

Default success check: HTTP 2xx, and either no business code, or a business code within `[0, '0000']`.

## Plugins

Ten built-in plugins. They are active as soon as they are installed, except `cache` and `share`, which are opted in per request, and `mock`, which is off by default. The built-in plugins are ordered by their stage, so you never sort them yourself.

| Stage | Built-in plugins (outer → inner) | Notes |
| --- | --- | --- |
| `outer` | `axpLoading` → `axpNotify` | Entered and left once per logical request; sees the final result |
| `prepare` | `axpRepath` → `axpFilter` | Shapes the request; runs once |
| `attempt` | `axpRetry` | Retry boundary; every attempt inside it runs again |
| `credential` | `axpAuth` | Injects credentials; on 401, refreshes and replays |
| `source` | `axpMock` → `axpShare` → `axpCache` | Where the result comes from; can answer without touching the network |
| none | `axpEnvs` | Runs only when installed; not part of the middleware chain |

### Shared conventions

These apply to every plugin, so they are described once here.

Per-request options accept four forms:

| Form | Meaning |
| --- | --- |
| `false` | Off for this call |
| `true` or omitted | Use the plugin-level configuration |
| shorthand | Documented per plugin, e.g. retry's number, share's policy string or loading's callback function; overrides only the main parameter |
| object | Field-by-field override. Precedence: request > plugin > built-in default. A field set to `null` or `undefined` inherits. Array fields are replaced as a whole. `enable: false` means the same as `false` |

Also:

- `null` and `undefined` are both treated as "omitted". Other values with undeclared types are an error; at runtime they are treated as omitted.
- Every plugin factory accepts `enable?: boolean`, default `true` (`axpMock` defaults to `false`). With `enable: false`, the plugin is not added to the chain, its `setup` doesn't run, and `api.inspect()` doesn't list it. A per-request option can't turn it back on.
- Per-request options don't accept function forms. The exception is options that are callbacks themselves, such as the per-request callback of `axpLoading`.
- The request each layer sees has already been merged with the axios instance's `defaults` (`baseURL`, `params`, `headers`, ...), just as the old interceptors saw it. So `repath` and `filter` can work on values from `defaults.params`, and those values are part of the key. If a layer drops a default `params` or `headers` field, axios's own second merge won't bring it back.
- A plugin's options are fixed when the plugin is created. Changing the options object afterwards has no effect; use per-request options, or create the plugin again.
- Plugins add their own per-request options by augmenting `AxpRequestOptions` through `declare module '@codejoo/axp'`, so axios's own types stay clean. The kernel's built-in per-request options are `wrap`, `throws`, `silent`, `key` and `signal`.

How errors thrown by callbacks are handled, in two groups:

- Notification callbacks (`loading`, `notify`, `stringify`, `onAccessExpired`, `onAccessDenied`): isolated, whether they throw synchronously or reject asynchronously. They don't affect the request result or plugin state, are reported with `console.error`, and ignore the `debug` switch.
- Decision callbacks (`shouldRetry`, retry's `delay` and `jitter` functions, `onFailure`, `isProtected`, `fallbackWhen`, `shouldCache`, `ready`): treated as program bugs and rethrown as-is.
- Exception: a throw from `onRefresh` counts as a failed refresh, not a bug.

### `axpLoading(options?)`

Stage: `outer` (built-in order 1). Counts logical requests; shows and hides come in pairs.

| Option | Default | Description |
| --- | --- | --- |
| `loading(visible)` | — | Show/hide callback |
| `delay` | `0` | After the count goes from 0 to 1, wait this long before showing. If the count drops back to 0 in the meantime, nothing is shown |
| `delayClose` | `0` | After the count goes from 1 to 0, wait this long before hiding. If a new request starts in the meantime, it stays visible |

Per request: `false`, `true`, a function (the callback for this call), or `{ enable, loading, delay, delayClose }`.

- The show starts with the logical request, including any time spent waiting for a token refresh.
- Retries and auth replays stay inside the same show/hide pair, so there is no flicker.
- Each callback is counted separately, so every callback sees matched `true` and `false` calls.
- If neither the plugin nor the request provides a callback, this request is not counted.
- For one callback, `delay` comes from the request that takes the count from 0 to 1, and `delayClose` from the request that takes it from 1 to 0.
- Removing the plugin (`eject` or `dispose`) cancels any pending delayed callbacks. If the UI is already showing, its callback gets one `false` right away, and requests still in flight won't call it again.

```ts
axpLoading({ loading: (v) => setSpinner(v), delay: 200, delayClose: 200 });
api.get('/list')(undefined, { loading: true });
api.get('/quiet')(undefined, { loading: { delay: 0 } });   // skip the anti-flicker delay for this call
```

### `axpNotify(options)`

Stage: `outer` (built-in order 2). Each logical request notifies at most once.

| Option | Default | Description |
| --- | --- | --- |
| `notify(message, r)` | **required** | Called when the message is non-empty |
| `stringify(r, ctx)` | see below | Return an empty string to stay silent |

Default `stringify`: returns `''` when `r.ok` is true, when `r.kind === 'cancel'`, or when `ctx.request.silent` is set. Otherwise it returns `r.message || \`${r.kind} ${r.status}\``.

Per request: `notify` is just a switch. `false` or `{ enable: false }` turns the notification off for this call; `true`, `null` and omitted all use the plugin configuration. The `notify` and `stringify` callbacks can't be overridden per request.

The kernel option `silent: true` makes the default `stringify` return an empty string. A custom `stringify` receives `ctx.request.silent` as-is and decides for itself whether to stay quiet; `notify: false` works with both the default and a custom `stringify`.

```ts
axpNotify({
  notify: (msg) => toast.error(msg),
  stringify: (r, ctx) => (r.ok || r.kind === 'cancel' || ctx.request.silent ? '' : r.message),
});
api.post('/pet')(body, { silent: true });   // no toast for this call
```

### `axpRepath(options?)`

Stage: `prepare` (built-in order 1).

| Option | Default | Description |
| --- | --- | --- |
| `pattern` | matches `{id}`, `:id`, `[id]` | Placeholder matching rule |
| `removeKey` | `true` | Remove parameters that were used to fill the path |

- Only the pathname is touched; the query string and hash are left alone.
- A value is taken from `params` first, then from `data`.
- Values are encoded with `encodeURIComponent` per path segment. A placeholder that appears more than once is replaced everywhere.
- The caller's objects are never modified; the rewritten request is handed to the inner layers through `next(patch)`.

Per request: `false` turns it off for this call; an object `{ enable, pattern, removeKey }` overrides the plugin-level fields.

```ts
axpRepath();
api.get('/pet/:id')(undefined, { params: { id: 5 } });   // → GET /pet/5
```

### `axpFilter(options?)`

Stage: `prepare` (built-in order 2). Active as soon as it is installed.

| Option | Default | Description |
| --- | --- | --- |
| `predicate([k, v])` | drops `null`, `undefined`, `NaN` and blank strings | Fields for which this returns exactly `true` are removed |
| `ignoreKeys` / `ignoreValues` | — | Keys or values exempt from filtering; `ignoreValues` recognizes `NaN` |

It only looks at the top-level fields of `params` and `data` (plain objects), without recursing. After stripping the empty fields it builds new objects and passes them on; special bodies such as `FormData` are left as they are.

Per request: `false` turns it off for this call; an object `{ enable, predicate, ignoreKeys, ignoreValues }` overrides the plugin-level fields (array fields are replaced as a whole, so an empty array clears the exemptions).

```ts
axpFilter();
api.get('/search')(undefined, { params: { q: 'x', page: '' } });   // sends ?q=x
```

### `axpRetry(options?)`

Stage: `attempt`. Active as soon as it is installed; retries up to 2 times by default.

| Option | Default | Description |
| --- | --- | --- |
| `max` | `2` | Maximum number of retries |
| `methods` | `get put head delete options trace` | Hard veto: a method not in this list is never retried, even if `shouldRetry` says yes |
| `statusCodes` | `[408, 429, 500, 502, 503, 504]` | Checked against `r.status` (the logical status) |
| `shouldRetry(r, attempt, ctx)` | — | A boolean is final; any other return value (including `undefined`) falls through to the next check |
| `delay` | `attempt => 300 * 2 ** (attempt - 1)` | A number, or a function `(attempt, max, r) => number`; a non-number result counts as 0 |
| `jitter` | — | `true` (uniform random between 0 and the delay), or `(delay) => number` (a negative, `NaN` or `Infinity` result keeps the original delay) |
| `delayMax` | `10_000` | Caps only the delay the plugin computes itself, applied after jitter |
| `respectRetryAfter` | `true` | Whether to honor the `Retry-After` header |
| `afterStatusCodes` | `[413, 429, 503]` | Only these statuses honor `Retry-After`; checked against `r.status` |
| `retryAfterMax` | `Infinity` | Upper bound for a wait derived from `Retry-After` |

How `Retry-After` works:

- It is only consulted after the decision to retry has been made. The header is read only if `respectRetryAfter` is on and `r.status` (the logical status) is in `afterStatusCodes`. The header comes from the raw HTTP response, so an HTTP 200 with a business code of 429 works too, as long as the response carries `Retry-After`.
- The value can be a number of seconds or an HTTP date (converted to a wait using the current clock). If it is missing or can't be parsed, the plugin falls back to the local `delay`.
- When it can be parsed, it wins: the wait is exactly what the header says. `delay` is not called, `jitter` is not applied, `delayMax` does not limit it, and only `retryAfterMax` caps it.
- A negative value, or a date already in the past, counts as 0: the retry goes out immediately, without falling back to `delay`.
- When it falls back to the local delay, the order is: compute `delay`, apply `jitter`, then cap with `delayMax`.

Per request: a number sets `max`; `false` turns it off; `true` uses the plugin configuration; an object overrides fields.

Decision order. Each step can end the decision early:

1. Per-request `retry: false`: no retry.
2. Method not in `methods`: no retry.
3. `r.kind` is `cancel`, `auth`, `internal` or `parse`: no retry.
4. `shouldRetry` returns a boolean: use it.
5. `r.kind` is `network` or `timeout`: retry.
6. Otherwise: `statusCodes.includes(r.status)`.

There is no `r.ok` step in this order: successful responses are passed to `shouldRetry` too. Under the default rules a success is not retried; if a custom `shouldRetry` returns `true`, a successful response is retried, for example a success that your business logic treats as an error.

At runtime:

- `ctx.markReplayable()` is called first, then `next()` runs in a loop.
- While waiting, the plugin listens to `ctx.signal`, so a cancel ends the wait immediately.
- When the attempts run out, the last result is returned. Whether it gets thrown is decided when the call settles.
- Every attempt goes through the `credential` and `source` plugins again. Auth injects the latest token, and on 401 it refreshes first and then replays.

```ts
axpRetry({ max: 3, statusCodes: [500, 502, 503, 504], jitter: true, delayMax: 10_000 });
api.get('/flaky')(undefined, { retry: 3 });                                          // up to 3 retries for this call
api.get('/flaky')(undefined, { retry: { max: 2, shouldRetry: (r) => r.code !== 0 } });
api.get('/flaky')(undefined, { retry: false });                                      // no retry for this call
```

### `axpAuth(options)`

Stage: `credential`. Handles token guarding, single-flight refresh on 401/403, and replay.

| Option | Default | Description |
| --- | --- | --- |
| `tokenManager` | **required** | An `ITokenManager` instance |
| `onRefresh(r, tm)` | **required** | Return `false` or throw to fail the refresh. Only one refresh runs at a time |
| `onAccessExpired(r, tm)` | **required** | The session has expired. On the 401 / refresh-failure path, notified once per round |
| `onAccessDenied(r, tm)` | same as `onAccessExpired` | Forbidden (403), or no token locally. With no token locally, called once for every protected request, with no de-duplication |
| `onFailure(r, tm, ctx)` | `defaultAuthFailure` | Returns one of the `AuthFailureAction` values |
| `methods` / `urlPattern` | `'*'` | Decides whether a request is protected. `urlPattern` only matches the pathname, uses URLPattern syntax; `!` negates |
| `isProtected(request)` | — | A boolean is the final answer. Evaluated once at the start of each attempt: every retry round evaluates it again, a replay after a refresh does not |
| `ready(tm, request)` | writes the `Authorization` header | Returns an `AxpRequestPatch` |

`AuthFailureAction` is a constant object with five actions: `Refresh` (`'refresh'`), `Replay` (`'replay'`), `Deny` (`'deny'`), `Expired` (`'expired'`) and `Others` (`'others'`, a failure unrelated to auth, returned as-is). If `onFailure` returns `null`, `undefined` or an unknown value, it behaves like `Others`.

Per request: `protected: boolean`, which takes precedence over `isProtected`, `methods` and `urlPattern`.

Main flow:

1. An unprotected request goes straight through.
2. A refresh is already running: wait for its result. If it fails, treat the session as expired and return `reason: 'expired'`. If the caller cancels while waiting, only that caller ends.
3. No token locally: call `onAccessDenied` and return a result with `kind: 'auth'` and `reason: 'unauthenticated'`. Every protected request goes through this, with no de-duplication. If `onAccessDenied` isn't set, `onAccessExpired` is what gets called, so between expiry and the next login, every protected request notifies once.
4. Inject the token and send the request. On success, return it; `internal` (a programming error) and `cancel` results also skip `onFailure` and are returned as-is.
5. On failure, `onFailure` decides: `refresh` refreshes and replays once; `replay` replays once with the current token; `deny` calls `onAccessDenied` and returns `reason: 'denied'`; `expired` clears the token, calls `onAccessExpired` and returns `reason: 'expired'`; anything else is returned as-is. `onFailure` may be async; if the caller cancels while it is running, the call settles as cancelled and nothing is notified.
6. If the replay still asks for a refresh or a replay, treat the session as expired. This prevents loops.

The default `defaultAuthFailure` only looks at the logical status:

- `status === 401`: `expired` if there is no token locally; `replay` if the token injected for this request differs from the current one (another request already refreshed it); otherwise `refresh`.
- `status === 403`: `deny`.
- Anything else: returned as-is.

Because it reads `r.status`, an HTTP 200 response with a business code of 401 is handled the same way.

You don't have to manage refresh availability yourself. When an expiry is detected, the plugin clears the token and records the cleared state. Until that state changes, it won't refresh or re-notify about expiry. Writing a new token on login re-enables everything automatically, so the login flow doesn't need to flip any flag.

Refresh is single-flight: only one runs at a time, and other requests queue for its result. Cancelling only ends the request that started or queued, and the refresh itself runs to completion. If `onRefresh` throws, it counts as a failed refresh and is not rethrown; a warning is logged only when `debug` is on.

`ITokenManager` requires `accessToken` (getter), `refreshToken` (getter), `set(access?, refresh?)` and `clear()`. The default `TokenManager` returns `Bearer <token>` from `accessToken` (or `undefined` when there is no token); `set` takes the bare token without the `Bearer ` prefix, and omitting a value or passing an empty one clears it. It persists to `localStorage` and restores the previous session when constructed; if storage is unavailable it works in memory only and doesn't throw.

```ts
axpAuth({
  tokenManager: new TokenManager(),
  urlPattern: ['/api/*', '!/api/public/*'],
  onRefresh: (r, tm) => refreshToken(tm),
  onAccessExpired: () => redirectToLogin(),
});
api.get('/public/banner')(undefined, { protected: false });   // no auth for this call
```

### `axpMock(options?)`

Stage: `source` (built-in order 1). Off by default.

| Option | Default | Description |
| --- | --- | --- |
| `enable` | `false` | Usually set to `import.meta.env.DEV` |
| `mock` | `false` | `true` sends every request to the mock |
| `mockUrl` | — | Base URL of the mock server. When it is not set (or is an empty string), mock is skipped and the request goes straight to the real endpoint |
| `fallbackWhen(r)` | `r.httpStatus === 404 \|\| r.kind === 'network'` | When true, falls back to the real endpoint |

Per request: `false` or `{ enable: false }` turns it off; `true` or any object (including an empty one) turns it on for this call, and an object can override `mockUrl` and `fallbackWhen`. This requires the plugin-level `enable` to be true: a per-request switch can't turn on a plugin that is off.

Without a `mockUrl` (none at plugin level or per request, or an empty string; a per-request empty string does not fall back to the plugin level), the call is not probed and is sent to the real endpoint as-is. With `debug` on, one warning is logged.

At runtime, the request is first rewritten to `mockUrl` as a probe (`cache: false`, `share: false`). The probe result is not written to the cache and doesn't take a share slot. If `fallbackWhen(r)` is true, the request then goes to the real endpoint. Rewrite rules: a relative URL is appended to `mockUrl`; an absolute URL loses its original origin but keeps its path, query and hash; a request with no `url` has its `baseURL` rewritten.

```ts
axpMock({ enable: import.meta.env.DEV, mockUrl: 'http://localhost:4000' });
api.get('/pet/1')(undefined, { mock: true });
api.get('/pet/1')(undefined, { mock: { fallbackWhen: (r) => r.httpStatus >= 500 } });
```

### `axpShare(options?)`

Stage: `source` (built-in order 2). Off by default; opted in per request.

| Option | Default | Description |
| --- | --- | --- |
| `policy` | `'start'` | `'start'`, `'end'` or `'race'` |
| `methods` | `['get', 'head']` | Other methods are never shared, even if opted in per request |

Per request: `true`, a policy string, `{ policy }`, or `false`. When the cache key is `null` (see the key section), the request is sent without sharing.

- **start**: the first caller sends the request for real; later callers share its result. Each caller listens to its own `signal` and `timeout`. Leaving alone only rejects that caller. The shared request is aborted only when every caller has left, so cancelling the first caller doesn't affect the followers.
- **end**: every caller sends its own request; only the latest one's result settles the shared result.
- **race**: every caller sends its own request; the first `ok` result wins. If they all fail, the last failure is used.

Followers get the same read-only `R`. `r.request` is the request that was originally sent. Each follower's own request is on its own `ctx.request`. A follower that times out gets `kind: 'timeout'`; a cancelled one gets `kind: 'cancel'`.

```ts
axpShare({ policy: 'start' });
api.get('/list')(undefined, { share: true });
api.get('/list')(undefined, { share: 'race' });
```

### `axpCache(options?)`

Stage: `source` (built-in order 3). Off by default; opted in per request.

| Option | Default | Description |
| --- | --- | --- |
| `expires` | `60_000` | Time to live, in milliseconds |
| `max` | `500` | LRU capacity. `Infinity` means no limit; values below 1 fall back to 500. Ignored once you inject a `store` |
| `methods` | `['get', 'head']` | Other methods are never cached, even if opted in per request |
| `clone` | — | `'shallow'`, `'deep'`, or `(data) => data`, applied to `r.data`. No copy by default: the caller shares the same reference |
| `shouldCache(r)` | `r.ok` | Decides which results are written to the cache |
| `store` | in-memory LRU | Implements `IAxpCacheStore<R>` (synchronous `get`, `set`, `delete`, `clear`, `size`). A persistent store will come later |

Per request: `true`; a number sets `expires`; an object `{ expires, key, clone, shouldCache }`, where `key` is an explicit cache key; `false` turns it off. An explicit key doesn't go through the key service, so it carries no `scope`, and it takes precedence over a per-request `key: false`; an empty string or a non-string key falls back to the key service.

- A hit returns the cached `R` directly (its `data` is copied according to `clone`). It doesn't touch the network and doesn't run `transformResponse` again. What is cached is the result after the check.
- On a miss, a successful result is also copied according to `clone` before it is returned; a failed result is returned as-is, without going through `clone`. `clone: 'deep'` relies on `structuredClone`; if the environment doesn't have it, the call throws before the request is sent instead of silently degrading to a shallow copy.
- A response that started earlier but returned later doesn't overwrite a newer result. After `clear()`, requests still in flight won't write their results back.
- Expired entries are removed lazily, when they are read. Sweeping only happens when a write exceeds capacity.
- Only GET and HEAD are cached by default. A POST with `cache: true` on the request is still not cached; to cache POST, change `methods` at the plugin level.
- When the cache key is `null` (a per-request `key: false`, or params with an unhashable value such as `FormData`; see the key section), cache passes through: the request is sent as-is, and the cache is neither read nor written. A per-request `cache: { key }` with an explicit key is unaffected and caches as usual.

Operations:

- `api.plugin(cache)` returns `{ remove(key): boolean, clear(): number }`, where `cache` is the same plugin object you passed in when creating the client.
- `removeCache(client, key)` and `clearCache(client)`: when the client has no cache plugin, they return `false` and `0`.

```ts
axpCache({ expires: 30_000 });
api.get('/list')(undefined, { cache: true });                 // uses the plugin-level expires
api.get('/list')(undefined, { cache: 10_000 });               // overrides expires for this call
api.get('/list')(undefined, { cache: { expires: 10_000, key: 'pets' } });

const cache = axpCache();
const api2 = createAxp({ plugins: [cache] });
api2.plugin(cache)?.clear();
```

### `axpEnvs(rules)`

Only has a `setup`; no middleware, so it is not in the chain. When installed, it picks the first rule that matches and writes its config into `client.axios.defaults`.

```ts
axpEnvs([
  { rule: () => import.meta.env.DEV, config: { baseURL: 'http://dev' } },
  { rule: () => import.meta.env.PROD, config: { baseURL: 'http://prod' } },
]);
```

- Once the first rule matches, later rules are not evaluated; if none matches, nothing is changed. If a rule function throws, `createAxp` or `use` throws.
- Fields are overwritten at the top level, with no deep merge: if the config has `headers`, it replaces the whole `headers` object in `defaults`.
- Removing the plugin (`eject`, `dispose`) does not restore the configuration that was written.
- Besides the array, you can pass an object `{ enable, rules }`, where `enable: false` turns the whole plugin off.

---

## Kernel features

These are not plugins. They are always present, and cannot be uninstalled.

### key

The kernel's key service computes the keys used by cache and share:

- Computed from method, url and params (params include the instance's `defaults.params`). Methods with a request body also include `data`. For account or tenant isolation, declare it explicitly with `scope` below instead of relying on a field that happens to sit in `defaults`.
- Lazy: computed the first time it is needed, then cached on the request object. A request that neither caches nor shares never computes a key.
- `Date` and `URLSearchParams` are hashed by content. Values whose content can't be reliably told apart (`FormData`, `Blob`, `Map`, `Set`, class instances without enumerable fields) and objects with circular references produce no key, so those requests are neither cached nor shared. Better to miss than to hit the wrong entry.

Client-level configuration:

| Option | Default | Description |
| --- | --- | --- |
| `scope` | — | Mixed into every key, e.g. an account id, so cache and share entries never leak across accounts. A string, a number, or a function `(request) => value` returning one of them. A function is evaluated every time a key is computed, so switching accounts doesn't require rebuilding the client. `null`, `undefined`, an empty string and `NaN` add nothing |
| `ignores` | — | Keys or values exempt from empty-value filtering |
| `sample` | `false` | Strings longer than 64 characters are sampled rather than hashed in full |

```ts
const api = createAxp({ key: { scope: () => session.userId } });   // read the current user each time a key is computed
```

Per-request `key`: omit it to compute automatically; pass a string to use an explicit key (the `scope` is added to it too, and a blank string counts as `false`); `false` means this request doesn't take part in cache or share. `true` is the same as omitting it (automatic); it is kept so old `key: true, cache: true` code keeps working, but new code can just leave it out. The automatic key includes params.

### Cancellation

- Each logical request has an `AbortController` linked to the caller's `signal`.
- `api.cancelAll(reason?)` aborts every in-flight logical request and returns how many it aborted. Cancelled requests get a result with `kind: 'cancel'`.
- `api.pending()` returns the number of in-flight logical requests.
- Retry waits, auth queueing and share followers all respond to cancellation.
- `cancelToken` is no longer supported; use `signal`.

```ts
const controller = new AbortController();
api.get('/list')(undefined, { signal: controller.signal });
controller.abort();                // cancel just this request

api.cancelAll('page left');        // cancel every in-flight request
```

### debug

```ts
createAxp({ debug: true });        // print plugin logs and record call sites for failures
createAxp({ debug: myLogger });    // print through your own logger
```

- When off, the plugins' `ctx.log` is an empty function, so there is no overhead.
- When on, thrown failures carry a `stack` (the call site where the request was started).
- Shape of a custom logger, `AxpLogger`: an object with three methods, `{ log, warn, error }`, each taking `(...args: unknown[])`. `debug: true` uses `console`.

---

## Stages and custom plugins

A plugin is a named object. `handle` is middleware, `(ctx, next) => Promise<R>`. `taps` splits one plugin into several segments, each attached to a different stage.

```ts
interface AxpPlugin<R, A> {
  readonly name: string;
  readonly enable?: boolean;                                                 // false: no setup, not in the chain
  readonly stage?: 'outer' | 'prepare' | 'attempt' | 'credential' | 'source'; // default 'attempt'; ignored when only taps are given
  readonly enforce?: 'pre' | 'post';                                         // default 'post'
  setup?(client): AxpPluginInstance<R, A> | void;   // called once per client; keep state here
  handle?: (ctx, next) => Promise<R>;                // stateless plugins can pass this directly
  taps?: readonly AxpTap<R>[];
}
```

Sorting rules:

1. The stage order is fixed, outer to inner, as in the table above.
2. Within a stage: custom plugins with `enforce: 'pre'` come first, then built-in plugins (fixed order), then custom plugins with `enforce: 'post'` (the default). Custom plugins keep the order of the `plugins` array.
3. A duplicate plugin name throws. Each `taps` segment is sorted on its own and named `<name>#<index>`.
4. The chain is compiled once, at `createAxp`, `use` and `eject`. A request in flight keeps the chain it started with.
5. `api.inspect()` returns the fully resolved order. Use it when debugging ordering.

```ts
import type { AxpPlugin } from '@codejoo/axp';

/** Record the duration of each attempt */
const timing: AxpPlugin = {
  name: 'timing',
  stage: 'attempt',
  async handle(ctx, next) {
    const t = performance.now();
    const r = await next();
    ctx.log.log(`[timing] ${ctx.request.url} ${r.status} ${performance.now() - t}ms`);
    return r;
  },
};

/** The request side and the response side sit at different depths */
const audit: AxpPlugin = {
  name: 'audit',
  taps: [
    { stage: 'credential', enforce: 'post', onRequest: (ctx) => report('send', ctx.request) },
    { stage: 'outer', onResponse: (r) => report('done', r.kind) },
  ],
};

/** Add a trace header for the inner layers, via next(patch) */
const addTrace: AxpPlugin = {
  name: 'add-trace',
  stage: 'prepare',
  handle: (ctx, next) => next({ headers: { 'X-Trace': crypto.randomUUID() } }),
};
```

A few conventions:

- Middleware doesn't modify `ctx.request`. To change the request for the inner layers, call `next(patch)`. The kernel shallow-merges the patch into a new request, and `headers` is merged one level deeper. A field set to `undefined` in the patch is removed from the request (the same goes for a single header inside `headers`).
- `handle` and `taps` can sit directly on the plugin object (stateless plugins) or be returned from `setup` (stateful plugins). If both are given, the one returned from `setup` wins; they are not merged.
- Keep state in `setup`, not in a closure created by the factory. That way one plugin object can be installed on several clients, and each client gets its own state. `extend` relies on this too.
- `next()` never throws; it always returns an `R`.

---

## Client API

```ts
function createAxp<S = unknown, R extends IAxpResponse = AxpResponse>(options?: AxpOptions<R>): AxpClient<S, R>;
```

| Option | Default | Description |
| --- | --- | --- |
| `axios` | `axios.create()` | Underlying instance |
| `plugins` | `[]` | Plugin array |
| `response` | `axpResponse()` | Response factory. Required when `R` is not `AxpResponse` |
| `key` | — | Key service configuration, see "Kernel features" |
| `reject` | `(r) => r` | Conversion applied to expected failures before they are thrown |
| `debug` | `false` | `true`, or a custom logger |

Client members:

| Member | Description |
| --- | --- |
| `api.get(path, methodConfig?)(payload?, callConfig?)` and the rest | The 10 lowercase axios verbs. `delete`, `post`, `put` and `patch` send the payload as `data`; the others send it as `params`. For `wrap` and `throws`, the call config wins; if it doesn't set them, the method config is inherited |
| `api.request<D>(config)` | Untyped escape hatch; also supports `wrap` and `throws` |
| `api.axios` | The underlying `AxiosInstance` |
| `api.extend(overrides?, opts?)` | Clones the axios defaults, then writes `overrides` (overwriting at the top level). Plugins are inherited by default (`opts.plugins: 'inherit'`); each plugin runs `setup` again, so state is not shared. You can also pass a new plugin array. `key`, `reject`, `debug` and `response` are inherited too. `overrides` is written after the plugins' `setup`, so it takes precedence over what `axpEnvs` wrote |
| `api.use(plugin)` | Installs a plugin; the chain is recompiled |
| `api.eject(name)` | Removes a plugin by name and cleans up its instance; returns whether it was removed. Requests in flight are unaffected and keep the chain they started with |
| `api.plugin(p)` | Returns the plugin instance's `api`, such as cache's `clear()`. Pass the plugin object, not its name. Returns `undefined` if it isn't installed |
| `api.cancelAll(reason?)` / `api.pending()` | See "Cancellation" |
| `api.inspect()` | Returns `[{ stage, name }]`, the resolved plugin order |
| `api.isResponse(e)` | See "Return shape and error handling" |
| `api.dispose()` | First aborts every in-flight request (they settle with `kind: 'cancel'`), then uninstalls the plugins in reverse order of registration and releases resources such as timers. Safe to call more than once; later calls do nothing. A disposed client can't send requests, `use` or `extend` any more. If one plugin throws during cleanup, the others still run, and the first exception is rethrown at the end |

```ts
const admin = api.extend({ baseURL: '/admin' });                         // inherits plugins; state is separate
const plain = api.extend({ baseURL: '/v2' }, { plugins: [axpCache()] }); // only the plugins you list
```

---

## Build and test

- `npm test`: unit and integration tests (`test/**`).
- `npm run build`: produces the unbundled ESM with type declarations, and the minified bundle for `./min`.
<!-- TODO: 待实现确认：产物目录结构和子路径清单，等 B6 打包后确认 -->
- `npm run e2e`: Playwright end-to-end tests in a real browser (`e2e/`), against a local mock server.
- `npm run accept`: black-box acceptance against the [api-ws-demo testkit](https://github.com/icodejoo/api-ws-demo/tree/main/testkit). A real HTTP server behind a network-condition proxy, run across scenario, network, response style and adapter combinations.
