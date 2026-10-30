# @codejoo/axp

[中文](./README.zh-CN.md) | English

A plugin-based HTTP client on top of `axios`. Retries, auth, caching, de-duplication, mocks and loading are all plugins, layered around each request in a fixed order of stages. Successes, failures and thrown errors are the same normalized object: the normalized response `IAxpResponse`.

Upgrading from the old API (`Axp.install` / `Axp.create`)? See the [migration guide](docs/guides/migrating-to-pipeline.md).

```bash
npm i @codejoo/axp   # peer dep: axios
```

Entry points:

- `@codejoo/axp`: unbundled ESM. Plugin subpaths (`@codejoo/axp/retry`, `@codejoo/axp/cache`, ...) share one module instance with the root entry, so mixing them is fine.
- `@codejoo/axp/min`: a single minified file with **its own copy** of the module. Mixed with the root entry, `isAxpResponse` still recognizes each other's responses (the brand is a `Symbol.for`), but plugin state and client instances are not shared. Use one of them per app. See [Output and subpaths](#output-and-subpaths).

Typed inference needs TypeScript ≥ 5.4.

## Quick start

```ts
import axios from "axios";
import { createAxp, axpRepath, axpRetry, axpAuth, axpCache, TokenManager } from "@codejoo/axp";
import type { Schema } from "./api-schema"; // your endpoint types, same shape as the old MethodSchema

const api = createAxp<Schema>({
  axios: axios.create({ baseURL: "/api" }),
  plugins: [
    axpRepath(), // fills {id} in paths; active once installed
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
const pet = await api.get("/pet/{id}")({ id: 1 }); // Pet
// Caching is opted in per request
const list = await api.get("/pet/findByStatus")({ status: "available" }, { cache: true });
```

If you use a custom response type `R`, write both `S` and `R` explicitly: TypeScript doesn't do partial inference, so `S` alone can't infer `R`. Without `S`, paths fall back to `string`.

## Return shape and error handling

Three per-request switches decide what a call returns: `wrap`, `throws` and `raw`.

| Call                | Success                                                                                                 | Failure                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| default             | returns `data`                                                                                          | `throw r`, where `r` is an `IAxpResponse`                                          |
| `{ wrap: true }`    | returns `WithData<R, D>`: the same shape as the response, with `data` typed as the business type        | same, thrown                                                                       |
| `{ throws: false }` | returns `AxpResult<R, D>`, a union discriminated by `ok`                                                | nothing is thrown; resolves with the `ok: false` branch, whose `data` is `unknown` |
| `{ raw: true }`     | returns `WithNative<WithData<R, D>>`: a wrap-shaped copy that also carries `raw`, `error` and `request` | the same copy, thrown (or resolved with `throws: false`)                           |

`raw: true` implies `wrap: true`; if `raw` and `wrap: false` show up together, `raw` wins. All three are per-request only (there is no client-level default), and `raw` is read from the request you actually passed, so `axios.defaults.raw` does nothing. The return type follows the effective `raw`, `wrap` and `throws` values; a wide `boolean` gives you the union of the possible shapes. One limit: if you pass a variable typed as `AxpRequestConfig` at the method level, TypeScript can't tell it apart from "not set", so the call is still typed as plain data.

A failure is thrown as a plain object, not an `Error`. By default it has no `stack`; turn on `debug` to attach the call site. Program bugs (an exception from middleware, a user callback, or an interceptor that isn't an axios error) are not treated as request failures: they are rethrown as-is, and `throws: false` doesn't swallow them.

With `throws: false`, narrow with `if (r.ok)` before reading `r.data`. Writing `<unknown>` or `<any>` explicitly overrides the schema inference. Request options merge in three layers, method-level < payload < call-level, and `wrap`, `throws` and `raw` read only the caller's `originRequest`.

```ts
// Default: a failure you catch is an IAxpResponse; real bugs are rethrown
try {
  await api.post("/pet")(body);
} catch (e) {
  if (api.isResponse(e))
    toast(e.message); // an expected failure
  else throw e; // a bug
}

// throws: false: failures resolve too; check ok
const res = await api.post("/pet")(body, { throws: false });
if (!res.ok) toast(res.message);

// wrap: true: when you want ok / status / code next to the data
const out = await api.get("/pet/{id}")({ id: 1 }, { wrap: true });
out.data; // Pet
out.ok;

// raw: true: when you really need the native response, exception or full request config
const full = await api.get("/pet/{id}")({ id: 1 }, { raw: true });
full.raw?.headers; // the original AxiosResponse; undefined when no response came back
full.error; // the original exception (network, timeout, ...)
full.request; // the complete request config that was sent
```

**Heads up for upgraders:** in 0.1.0, `raw: true` meant "return the original envelope body". It still compiles and runs, but the shape is different now: you get the `R` copy above. If you only wanted the old envelope, read `r.raw?.data`.

`raw`, `error` and `request` on that copy are non-enumerable own properties, so `JSON.stringify` and spreading don't pick them up. A thrown failure carries them too, but in a `catch` all you have is an `unknown`; read them with `nativeOf`:

```ts
import { nativeOf } from "@codejoo/axp";
try {
  await api.get("/pet/{id}")({ id: 1 }, { raw: true });
} catch (e) {
  const native = nativeOf(e); // { raw?, error?, request? } | undefined
  console.warn(native?.raw?.status, native?.error);
}
```

If you configured `reject` to wrap failures in an `Error`, `nativeOf(e)` returns `undefined` for that `Error`; read the wrapped response instead, e.g. `nativeOf(e.response)` with the `{ response: r }` wrapper shown under `reject` below.

`nativeOf` returns `undefined` for anything that isn't a `raw: true` copy. It spots a copy by its non-enumerable own `raw`, so a custom response factory shouldn't define a non-enumerable `raw` of its own.

Why it's opt-in: a thrown `R` is often held for a long time by Sentry, TanStack Query and friends. If it dragged an AxiosError (with `.request`, `.response`, `.config`) or the request body along, none of that could be garbage-collected. So `R` stays light by default, and the native objects live on the logical request only until it settles. Asking for `raw: true` means you accept that the copy keeps them alive.

Plugins that need the native data don't read it off `R`; they read `ctx.native` (`{ response?, error? }`, read-only). It holds the latest transport attempt, which isn't guaranteed to pair with the response you're looking at (an attempt that returns before reaching the transport doesn't refresh it). It's cleared and sealed once the request settles.

Required fields of `IAxpResponse<D, C extends string | number = number>`:

| Field    | Meaning                                                                          |
| -------- | -------------------------------------------------------------------------------- |
| `ok`     | Success; defaults to HTTP 2xx with business code `0` or `'0000'`                 |
| `status` | HTTP status; `0` when there is no response                                       |
| `code`   | Business code, default `0`; generic `C` can be a string or a string/number union |
| `data`   | Business data; `null` when absent                                                |

That's all the interface declares: no `message`, `raw` or `error`. `message` (an empty string by default, `null` allowed) is a business concept that lives on the default class `AxpResponse`, which also provides `request`, `stack`, `toJSON()` and protected `parse(body, raw)`. None of those are interface requirements, and the kernel no longer fills in a `message` for your own implementation. `r.request` is a light view, just `{ method, url }`; the full request config is on `ctx.request` / `ctx.originRequest`, or on the `raw: true` copy. Share followers get the leader's `R`, so their `r.request` is the request that was actually sent; a cache hit's `request` belongs to the current caller. Neither `raw` nor `error` is cached.

The kernel records failure sources in a non-enumerable `AXP_FAILURE` marker. Read it with `failureOf(r)`, which returns `{ type, reason?, error? } | undefined`. `error` is the original exception and only `internal` failures have it (a program bug the kernel turned into a failure); network, timeout and cancel failures no longer carry one, so use `raw: true` if you need those. `toJSON()` projects the marker as just `{ type, reason }`, so the exception never leaks through serialization. `AXP_FAILURES` provides the constants: `cancel`, `timeout`, `network`, `parse`, `auth`, `internal`. Marking a failure forces `ok === false`, even with a custom success rule. HTTP and business-code failures alone have no marker; inspect `ok`, `status` and `code`. Use `api.isCancel(e)` or `isAxpCancel(e)` for cancellation.

```ts
import { failureOf } from "@codejoo/axp";
const r = await api.get("/profile")(undefined, { throws: false });
if (!api.isCancel(r) && !r.ok) console.warn(r.status, r.code, failureOf(r)?.type, failureOf(r)?.reason);
```

Three related helpers:

- `api.isResponse(e)`: tells an expected failure apart from a program bug, and narrows the type to this client's `R`. It checks the same thing as `isAxpResponse(e)`.
- `createAxp({ reject })`: an expected failure goes through this function before it is thrown. The default returns it unchanged. If you use a library that needs an `Error` (Sentry, TanStack Query, ...), wrap it here:

  ```ts
  createAxp({ reject: (r) => Object.assign(new Error(r.message ?? ""), { response: r }) });
  ```

- `debug`: when on, a thrown failure carries the `stack` of the call site where the request was started (with `throws: false` nothing is thrown, so there is none). It is only recorded in debug mode, so production has no extra cost.

`throws` is a per-request option that defaults to `true`; there is no client-level default, because the return type could not reflect it honestly.

## Custom responses

Subclass `AxpResponse` and override `parse(body, raw)` for different body fields, or override `ok` for a different success rule. Keep `status` as the HTTP status.

```ts
import { AxpResponse, axpResponse, createAxp } from "@codejoo/axp";

class MyResponse<D = unknown> extends AxpResponse<D> {
  protected override parse(body: unknown) {
    const value = body as { resultCode?: number; payload?: D; text?: string | null } | null;
    return { code: value?.resultCode ?? 0, data: value?.payload ?? null, message: value?.text ?? "" };
  }
  override get ok() {
    return this.status >= 200 && this.status < 300 && this.code === 200;
  }
}

const api = createAxp<Schema, MyResponse>({ response: axpResponse<MyResponse>({ type: MyResponse }) });
```

- Do not redeclare `status`, `code`, `data` or `message` with subclass field initializers: they overwrite the base parser's results. The base constructor calls `parse`, so it must not depend on uninitialized subclass fields.
- Default parsing: when the body has `code` and either `data` or `message`, read those fields; otherwise use the whole body as data and `0` as code. Missing data becomes `null`; missing message becomes an empty string.
- A non-default `R` requires `response`. You can implement the interface and return a plain object from `create(init, raw?)`; the kernel adds the brand and fills in missing code/data defaults. Provide `message` yourself when you implement the interface. Cache reconstruction has no raw response: restore custom fields from init without overwriting them with defaults.

| `axpResponse` option | Default       | Meaning                                                                   |
| -------------------- | ------------- | ------------------------------------------------------------------------- |
| `type`               | `AxpResponse` | Response subclass constructor                                             |
| `create(init, raw?)` | —             | Custom construction; takes precedence over type                           |
| `expectJson`         | `false`       | Marks parse failure for 2xx non-empty unparsed text declared as JSON/HTML |

## Plugins

Ten built-in plugins. They are active as soon as they are installed, except `cache` and `share`, which are opted in per request, and `mock`, which is off by default. The built-in plugins are ordered by their stage, so you never sort them yourself.

| Stage        | Built-in plugins (outer → inner)    | Notes                                                                |
| ------------ | ----------------------------------- | -------------------------------------------------------------------- |
| `outer`      | `axpLoading` → `axpNotify`          | Entered and left once per logical request; sees the final result     |
| `prepare`    | `axpRepath` → `axpFilter`           | Shapes the request; runs once                                        |
| `attempt`    | `axpRetry`                          | Retry boundary; every attempt inside it runs again                   |
| `credential` | `axpAuth`                           | Injects credentials; on 401, refreshes and replays                   |
| `source`     | `axpMock` → `axpShare` → `axpCache` | Where the result comes from; can answer without touching the network |
| none         | `axpEnvs`                           | Runs only when installed; not part of the middleware chain           |

### Shared conventions

These apply to every plugin, so they are described once here.

Per-request options accept four forms:

| Form              | Meaning                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `false`           | Off for this call                                                                                                                                                                                        |
| `true` or omitted | Use the plugin-level configuration                                                                                                                                                                       |
| shorthand         | Documented per plugin, e.g. retry's number, share's policy string or loading's callback function; overrides only the main parameter                                                                      |
| object            | Field-by-field override. Precedence: request > plugin > built-in default. A field set to `null` or `undefined` inherits. Array fields are replaced as a whole. `enable: false` means the same as `false` |

Also:

- `null` and `undefined` are both treated as "omitted". Other values with undeclared types are an error; at runtime they are treated as omitted.
- Every plugin factory accepts `enable?: boolean`, default `true` (`axpMock` defaults to `false`). With `enable: false`, the plugin is not added to the chain, its `setup` doesn't run, and `api.inspect()` doesn't list it. A per-request option can't turn it back on.
- The transport does not clone the request body. Don't mutate `data` in place in transformers or interceptors (it pollutes replays and the caller); return a new object instead. With `debug: true`, in-place mutation of a request body or cached data logs a warning, and so does passing a per-request option whose plugin isn't installed (e.g. `retry: 2` without axpRetry).
- Per-request options don't accept function forms. The exception is options that are callbacks themselves, such as the per-request callback of `axpLoading`.
- The request each layer sees has already been merged with the axios instance's `defaults` (`baseURL`, `params`, `headers`, ...), just as the old interceptors saw it. So `repath` and `filter` can work on values from `defaults.params`, and those values are part of the key. If a layer drops a default `params` or `headers` field, axios's own second merge won't bring it back.
- A plugin's options are fixed when the plugin is created. Changing the options object afterwards has no effect; use per-request options, or create the plugin again.
- Plugins add their own per-request options by augmenting `AxpRequestOptions` through `declare module '@codejoo/axp'`, so axios's own types stay clean. The kernel's built-in per-request options are `wrap`, `throws`, `raw`, `silent`, `key` and `signal`.
- Helpers for custom plugins are exported from the root entry: `cancelIfAborted`, `waitAbortable`, `fireNotice`, `resolveOption`, `resolveRequestOption`, `isEnabled`, plus the types `AxpOption` and `IPluginSwitch`. The package declares `sideEffects: false`, so it tree-shakes.
- State is shared by the resource it represents: cache and share per client; auth per `TokenManager`; loading per callback function. A client made with `extend()` therefore shares the auth session and loading counts with its parent.
- For business-style responses (HTTP 200 plus a business code), set `createAxp({ statusOf })` to return the effective status. Retry's and auth's default rules read `ctx.statusOf(r)`; `r.status` stays the HTTP status.

How errors thrown by callbacks are handled, in two groups:

- Notification callbacks (`loading`, `notify`, `stringify`, `onAccessExpired`, `onAccessDenied`): isolated, whether they throw synchronously or reject asynchronously. They don't affect the request result or plugin state, are reported with `console.error`, and ignore the `debug` switch.
- Decision callbacks (`shouldRetry`, retry's `delay` and `jitter` functions, `onFailure`, `isProtected`, `fallbackWhen`, `shouldCache`, `ready`): treated as program bugs and rethrown as-is.
- Exception: a throw from `onRefresh` counts as a failed refresh, not a bug.

Response-side callbacks take the request context as an extra last argument: retry's `respectRetryAfter` (function form) and `delay`, all of auth's `onRefresh` / `onAccessExpired` / `onAccessDenied`, cache's `shouldCache` (plugin level and per request) and mock's `fallbackWhen`. Because `r.request` is now a light `{ method, url }`, a callback that needs the full request config reads `ctx.request` (what this layer sees) or `ctx.originRequest` (what the caller passed). Older callbacks that take fewer arguments keep working.

### `axpLoading(options?)`

Stage: `outer` (built-in order 1). Counts logical requests; shows and hides come in pairs.

| Option             | Default | Description                                                                                                                     |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `loading(visible)` | —       | Show/hide callback                                                                                                              |
| `delay`            | `0`     | After the count goes from 0 to 1, wait this long before showing. If the count drops back to 0 in the meantime, nothing is shown |
| `delayClose`       | `0`     | After the count goes from 1 to 0, wait this long before hiding. If a new request starts in the meantime, it stays visible       |

Per request: `false`, `true`, a function (the callback for this call), or `{ enable, loading, delay, delayClose }`.

- The show starts with the logical request, including any time spent waiting for a token refresh.
- Retries and auth replays stay inside the same show/hide pair, so there is no flicker.
- Counts are shared per callback function: when a parent and child client (or several clients) use the same spinner callback, it is shown and hidden only once. Every callback sees matched `true` and `false` calls.
- If neither the plugin nor the request provides a callback, this request is not counted.
- For one callback, `delay` comes from the request that takes the count from 0 to 1, and `delayClose` from the request that takes it from 1 to 0.
- Removing the plugin (`eject` or `dispose`) cancels any pending delayed callbacks. If the UI is already showing, its callback gets one `false` right away, and requests still in flight won't call it again.

```ts
axpLoading({ loading: (v) => setSpinner(v), delay: 200, delayClose: 200 });
api.get("/list")(undefined, { loading: true });
api.get("/quiet")(undefined, { loading: { delay: 0 } }); // skip the anti-flicker delay for this call
```

### `axpNotify(options)`

Stage: `outer` (built-in order 2). Each logical request notifies at most once.

| Option               | Default      | Description                                                                                          |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `notify(message, r)` | **required** | Called when the message is non-empty                                                                 |
| `stringify(r, ctx)`  | **required** | Returns `string \| null \| undefined \| false`; a falsy value or an empty string means "stay silent" |

`stringify` has no default any more, and there is no fallback copy: you decide what each failure says. The kernel filters first, so `stringify` is never called for a success, a cancellation or a `silent` request. It is not filtered for `internal` failures (program bugs); whether to show those is up to you.

Per request: `notify` is just a switch. `false` or `{ enable: false }` turns the notification off for this call; `true`, `null` and omitted all use the plugin configuration. The `notify` and `stringify` callbacks can't be overridden per request.

A copy-paste starting point (adjust the wording to your product):

```ts
import { axpNotify, failureOf } from "@codejoo/axp";

axpNotify({
  notify: (msg) => toast.error(msg),
  stringify: (r) => {
    const failure = failureOf(r);
    if (failure?.type === "internal") return null; // a program bug: keep it out of the user's face
    if (failure?.type === "timeout") return "The request timed out, please try again";
    if (failure?.type === "network") return "Network error, please check your connection";
    if (failure?.type === "auth") return null; // axpAuth already tells the user
    if (r.status >= 500) return "Server error, please try again later";
    return r.message || `Request failed (status ${r.status})`;
  },
});
api.post("/pet")(body, { silent: true }); // no toast for this call
```

### `axpRepath(options?)`

Stage: `prepare` (built-in order 1).

| Option      | Default                       | Description                                       |
| ----------- | ----------------------------- | ------------------------------------------------- |
| `pattern`   | matches `{id}`, `:id`, `[id]` | Placeholder matching rule                         |
| `removeKey` | `true`                        | Remove parameters that were used to fill the path |

- Only the pathname is touched; the query string and hash are left alone.
- A value is taken from `params` first, then from `data`.
- Values are encoded with `encodeURIComponent` per path segment. A placeholder that appears more than once is replaced everywhere.
- The caller's objects are never modified; the rewritten request is handed to the inner layers through `next(patch)`.

Per request: `false` turns it off for this call; an object `{ enable, pattern, removeKey }` overrides the plugin-level fields.

```ts
axpRepath();
api.get("/pet/:id")(undefined, { params: { id: 5 } }); // → GET /pet/5
```

### `axpFilter(options?)`

Stage: `prepare` (built-in order 2). Active as soon as it is installed.

| Option                        | Default                                            | Description                                                           |
| ----------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `predicate([k, v])`           | drops `null`, `undefined`, `NaN` and blank strings | Fields for which this returns exactly `true` are removed              |
| `ignoreKeys` / `ignoreValues` | —                                                  | Keys or values exempt from filtering; `ignoreValues` recognizes `NaN` |

It only looks at the top-level fields of `params` and `data` (plain objects), without recursing. After stripping the empty fields it builds new objects and passes them on; special bodies such as `FormData` are left as they are.

Per request: `false` turns it off for this call; an object `{ enable, predicate, ignoreKeys, ignoreValues }` overrides the plugin-level fields (array fields are replaced as a whole, so an empty array clears the exemptions).

```ts
axpFilter();
api.get("/search")(undefined, { params: { q: "x", page: "" } }); // sends ?q=x
```

### `axpRetry(options?)`

Stage: `attempt`. Active as soon as it is installed; retries up to 2 times by default.

| Option                         | Default                               | Description                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `max`                          | `2`                                   | Maximum number of retries                                                                                                                                                                                           |
| `methods`                      | `get put head delete options trace`   | Hard veto: a method not in this list is never retried, even if `shouldRetry` says yes                                                                                                                               |
| `statusCodes`                  | `[408, 429, 500, 502, 503, 504]`      | Checked against `ctx.statusOf(r)` (effective status, HTTP by default)                                                                                                                                               |
| `shouldRetry(r, attempt, ctx)` | —                                     | A boolean is final; any other return value (including `undefined`) falls through to the next check                                                                                                                  |
| `delay`                        | `attempt => 300 * 2 ** (attempt - 1)` | A number, or a function `(attempt, max, r, ctx) => number`; a non-number result counts as 0                                                                                                                         |
| `jitter`                       | —                                     | `true` (uniform random between 0 and the delay), or `(delay) => number` (a negative, `NaN` or `Infinity` result keeps the original delay)                                                                           |
| `delayMax`                     | `10_000`                              | Caps only the delay the plugin computes itself, applied after jitter                                                                                                                                                |
| `respectRetryAfter`            | `true`                                | A boolean uses afterStatusCodes; `(r, ctx) => boolean` decides independently and does not consult afterStatusCodes. Missing/invalid headers fall back to local delay; no jitter or delayMax applies to server waits |
| `afterStatusCodes`             | `[413, 429, 503]`                     | Effective statuses (`ctx.statusOf`); see the business-code example below                                                                                                                                            |
| `retryAfterMax`                | `60_000`                              | Skip retry and return the current response when the server asks for more; `Infinity` always honors it                                                                                                               |

How `Retry-After` works:

- The wait is read from the response headers once, at the transport, and rides along with `R` as a small private fact, so share followers (who get the leader's very `R`) see it too. A response interceptor that throws an `AxiosError` carrying a `response` is classified as `network` with `r.status` 0, so the boolean form (which checks `afterStatusCodes.includes(r.status)`) does not honor its `Retry-After`; only a `respectRetryAfter` function, which decides on its own, will use that `error.response`'s header.
- Retry-After is checked only after deciding to retry. A respectRetryAfter function decides whether to use it; otherwise afterStatusCodes matches the effective status. For business-code responses configure `statusOf` or a function, as in the complete example below.
- The value can be a number of seconds or an HTTP date (converted to a wait using the current clock). If it is missing or can't be parsed, the plugin falls back to the local `delay`.
- When parseable, a wait above retryAfterMax stops retrying; otherwise use the exact server wait without calling delay or applying jitter/delayMax.
- A negative value, or a date already in the past, counts as 0: the retry goes out immediately, without falling back to `delay`.
- When it falls back to the local delay, the order is: compute `delay`, apply `jitter`, then cap with `delayMax`.

Per request: a number sets `max`; `false` turns it off; `true` uses the plugin configuration; an object overrides fields.

Decision order. Each step can end the decision early:

1. Per-request `retry: false`: no retry.
2. Method not in `methods`: no retry.
3. `failureOf(r)?.type` is `cancel`, `auth`, `internal` or `parse`: no retry.
4. `shouldRetry` returns a boolean: use it.
5. `failureOf(r)?.type` is `network` or `timeout`: retry.
6. Otherwise: `statusCodes.includes(ctx.statusOf(r))`.

There is no `r.ok` step in this order: successful responses are passed to `shouldRetry` too. Under the default rules a success is not retried; if a custom `shouldRetry` returns `true`, a successful response is retried, for example a success that your business logic treats as an error.

At runtime:

- `ctx.markReplayable()` is called first, then `next()` runs in a loop.
- While waiting, the plugin listens to `ctx.signal`, so a cancel ends the wait immediately.
- When the attempts run out, the last result is returned. Whether it gets thrown is decided when the call settles.
- Every attempt goes through the `credential` and `source` plugins again. Auth injects the latest token, and on 401 it refreshes first and then replays.

```ts
axpRetry({ max: 3, statusCodes: [500, 502, 503, 504], jitter: true, delayMax: 10_000 });
api.get("/flaky")(undefined, { retry: 3 }); // up to 3 retries for this call
api.get("/flaky")(undefined, { retry: { max: 2, shouldRetry: (r) => r.code !== 0 } });
api.get("/flaky")(undefined, { retry: false }); // no retry for this call
```

### `axpAuth(options)`

Stage: `credential`. Handles token guarding, single-flight refresh on HTTP 401, and replay.

| Option                        | Default                           | Description                                                                                                                                           |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokenManager`                | **required**                      | An `ITokenManager` instance                                                                                                                           |
| `onRefresh(r, tm, ctx)`       | **required**                      | Return `false` or throw to fail the refresh. Only one refresh runs at a time                                                                          |
| `refreshTimeout`              | `30_000`                          | Refresh wait limit in ms; 0 or Infinity disables it; expiry counts as refresh failure                                                                 |
| `onAccessExpired(r, tm, ctx)` | **required**                      | The session has expired. On the 401 / refresh-failure path, notified once per round                                                                   |
| `onAccessDenied(r, tm, ctx)`  | same as `onAccessExpired`         | Forbidden (403), or no token locally. With no token locally, notified at most once per session round; the count restarts after a new token is written |
| `onFailure(r, tm, ctx)`       | `defaultAuthFailure`              | Returns one of the `AuthFailureAction` values                                                                                                         |
| `methods` / `urlPattern`      | `'*'`                             | Decides whether a request is protected. `urlPattern` only matches the pathname, uses URLPattern syntax; `!` negates                                   |
| `isProtected(request)`        | —                                 | A boolean is the final answer. Evaluated once at the start of each attempt: every retry round evaluates it again, a replay after a refresh does not   |
| `ready(tm, request)`          | writes the `Authorization` header | Returns an `AxpRequestPatch`                                                                                                                          |

`AuthFailureAction` is a constant object with five actions: `Refresh` (`'refresh'`), `Replay` (`'replay'`), `Deny` (`'deny'`), `Expired` (`'expired'`) and `Others` (`'others'`, a failure unrelated to auth, returned as-is). If `onFailure` returns `null`, `undefined` or an unknown value, it behaves like `Others`.

Per request: `protected: boolean`, which takes precedence over `isProtected`, `methods` and `urlPattern`.

Main flow:

1. An unprotected request goes straight through.
2. A refresh is already running: wait for its result. If it fails, treat the session as expired and return `failureOf(r)?.reason === 'expired'`. If the caller cancels while waiting, only that caller ends.
3. No token locally: call `onAccessDenied` and return a result with `failureOf(r)` equal to `{ type: 'auth', reason: 'unauthenticated' }`. Every protected request is still rejected locally, but the notification fires at most once per session round (it restarts after a new token is written). If `onAccessDenied` isn't set, `onAccessExpired` is what gets called, still at most once per round.
4. Inject the token and send the request. On success, return it; `internal` (a programming error) and `cancel` results also skip `onFailure` and are returned as-is.
5. On failure, `onFailure` decides: `refresh` refreshes and replays once; `replay` replays once with the current token; `deny` calls `onAccessDenied` and returns `failureOf(r)?.reason === 'denied'`; `expired` clears the token, calls `onAccessExpired` and returns `failureOf(r)?.reason === 'expired'`; anything else is returned as-is. `onFailure` may be async; if the caller cancels while it is running, the call settles as cancelled and nothing is notified.
6. If the replay still asks for a refresh or a replay, treat the session as expired. This prevents loops. For a 401 you don't want treated as expiry, return `Others` from `onFailure`.

The default `defaultAuthFailure` reads `ctx.statusOf(r)` (HTTP status by default):

- status 401: `expired` if there is no token locally; `replay` if the token injected for this request differs from the current one (another request already refreshed it); otherwise `refresh`.
- status 403: `deny`.
- Anything else: returned as-is.

For business-code auth routing, see [Usage warnings and business responses](#usage-warnings-and-business-responses).

You don't have to manage refresh availability yourself. When an expiry is detected, the plugin clears the token and records the cleared state. Until that state changes, it won't refresh or re-notify about expiry. Writing a new token on login re-enables everything automatically, so the login flow doesn't need to flip any flag.

Session state (single-flight refresh, the expired mark and the no-token notice mark) is shared per `TokenManager`: a child client from `extend()` and any other client using the same tm refresh single-flight and notify once together.

Refresh is single-flight: only one runs at a time, and other requests queue for its result. The `ctx` that `onRefresh` and `onAccessExpired` receive in that case belongs to the first request that triggered the refresh, so don't use its `ctx.signal` to abort the shared refresh: other requests are waiting on it. Cancelling only ends the request that started or queued, and the refresh itself runs to completion. If `onRefresh` throws, it counts as a failed refresh and is not rethrown; a warning is logged only when `debug` is on.

`ITokenManager` requires `accessToken` (getter), `refreshToken` (getter), `set(access?, refresh?)` and `clear()`. The default `TokenManager` returns `Bearer <token>` from `accessToken` (or `undefined` when there is no token); `set` takes the bare token without the `Bearer ` prefix, and omitting a value or passing an empty one clears it. It persists to `localStorage` and restores the previous session when constructed; if storage is unavailable it works in memory only and doesn't throw. Storage is probed on first read or write, so importing the module has no side effects.

```ts
axpAuth({
  tokenManager: new TokenManager(),
  urlPattern: ["/api/*", "!/api/public/*"],
  onRefresh: (r, tm) => refreshToken(tm),
  onAccessExpired: () => redirectToLogin(),
});
api.get("/public/banner")(undefined, { protected: false }); // no auth for this call
```

`ready`, `onFailure` and refresh queueing are cancellable; cancellation is rechecked after async waits. If login/logout replaces the token during refresh, an old failed refresh cannot clear the new session or notify expiry. If the user logs out while an async `ready` is still running, the request is rejected locally as unauthenticated and no credential-less request goes out. After the last client holding that tm calls `dispose()`, a refresh that was in flight and fails late no longer clears the session or calls `onAccessExpired`. A refresh timeout does not stop the callback itself; callers own any late session writes.

### `axpMock(options?)`

Stage: `source` (built-in order 1). Off by default.

| Option                 | Default                                                  | Description                                                                                                                                 |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `enable`               | `false`                                                  | Usually set to `import.meta.env.DEV`                                                                                                        |
| `mock`                 | `false`                                                  | `true` sends every request to the mock                                                                                                      |
| `mockUrl`              | —                                                        | Base URL of the mock server. When it is not set (or is an empty string), mock is skipped and the request goes straight to the real endpoint |
| `fallbackWhen(r, ctx)` | `r.status === 404 \|\| failureOf(r)?.type === 'network'` | When true, falls back to the real endpoint                                                                                                  |

Per request: `false` or `{ enable: false }` turns it off; `true` or any object (including an empty one) turns it on for this call, and an object can override `mockUrl` and `fallbackWhen`. This requires the plugin-level `enable` to be true: a per-request switch can't turn on a plugin that is off.

Without a `mockUrl` (none at plugin level or per request, or an empty string; a per-request empty string does not fall back to the plugin level), the call is not probed and is sent to the real endpoint as-is. With `debug` on, one warning is logged.

At runtime, the request is first rewritten to `mockUrl` as a probe (`cache: false`, `share: false`). The probe result is not written to the cache and doesn't take a share slot. If `fallbackWhen(r, ctx)` is true, the request then goes to the real endpoint. Rewrite rules: a relative URL is appended to `mockUrl`; an absolute URL loses its original origin but keeps its path, query and hash; a request with no `url` has its `baseURL` rewritten.

```ts
axpMock({ enable: import.meta.env.DEV, mockUrl: "http://localhost:4000" });
api.get("/pet/1")(undefined, { mock: true });
api.get("/pet/1")(undefined, { mock: { fallbackWhen: (r) => r.status >= 500 } });
```

### `axpShare(options?)`

Stage: `source` (built-in order 2). Off by default; opted in per request.

| Option    | Default           | Description                                                  |
| --------- | ----------------- | ------------------------------------------------------------ |
| `policy`  | `'start'`         | `'start'`, `'end'` or `'race'`                               |
| `methods` | `['get', 'head']` | Other methods are never shared, even if opted in per request |

Per request: `true`, a policy string, `{ policy }`, or `false`. When the cache key is `null` (see the key section), the request is sent without sharing.

- **start**: the first caller sends the request for real; later callers share its result. Each caller listens to its own `signal` and `timeout`. Leaving alone only rejects that caller. The shared request is aborted only when every caller has left, so cancelling the first caller doesn't affect the followers.
- **end**: every caller sends its own request; the latest non-withdrawn caller settles the shared result. Self-cancellation withdraws that caller and falls back to an in-flight or most recently completed call.
- **race**: every caller sends its own request; the first `ok` result wins. If they all fail, use the last non-withdrawn failure; self-cancellation never becomes another caller's result. A timeout is not a withdrawal.

Followers get the same read-only `R` as the leader. `r.request` is the leader's light `{ method, url }` view; each follower's own full request is on its own `ctx.request`. The `Retry-After` fact travels with that `R`, so followers see it too. A follower that times out gets `failureOf(r)?.type === 'timeout'`; a cancelled one gets `api.isCancel(r) === true`.

```ts
axpShare({ policy: "start" });
api.get("/list")(undefined, { share: true });
api.get("/list")(undefined, { share: "race" });
```

### `axpCache(options?)`

Stage: `source` (built-in order 3). Off by default; opted in per request.

| Option                | Default           | Description                                                                                                                                   |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `expires`             | `60_000`          | Time to live, in milliseconds                                                                                                                 |
| `max`                 | `500`             | LRU capacity. `Infinity` means no limit; values below 1 fall back to 500. Ignored once you inject a `store`                                   |
| `methods`             | `['get', 'head']` | Other methods are never cached, even if opted in per request                                                                                  |
| `clone`               | —                 | `'shallow'`, `'deep'`, or `(data) => data`, applied to `r.data`. No copy by default: the caller shares the same reference                     |
| `shouldCache(r, ctx)` | `r.ok`            | Decides which results are written to the cache                                                                                                |
| `store`               | in-memory LRU     | `IAxpCacheStore` snapshot store; sync or Promise methods, optional size; [full contract](docs/design/plugin-spec.md#63-cachesource内置次序-3) |

Per request: `true`; a number sets `expires`; an object `{ expires, key, clone, shouldCache }`, where `key` is an explicit cache key; `false` turns it off. An explicit key doesn't go through the key service, so it carries no `scope`, and it takes precedence over a per-request `key: false`; an empty string or a non-string key falls back to the key service.

- Entries are `{ snapshot, expiresAt }`. A hit rebuilds a fresh R through the response factory, with the current caller's request and no persisted raw/error/stack. A snapshot's `message` is read in a structured way, whatever your `R` looks like. Data follows clone; transformResponse is not rerun. A cancelled caller never receives a cache hit.
- On a miss, a successful result is also copied according to `clone` before it is returned; a failed result is returned as-is, without going through `clone`. `clone: 'deep'` relies on `structuredClone`; if the environment doesn't have it, the call throws before the request is sent instead of silently degrading to a shallow copy.
- A response that started earlier but returned later doesn't overwrite a newer result. After `clear()`, requests still in flight won't write their results back.
- Expired entries are removed lazily on reads; the memory store also sweeps at throttled intervals during overflow and finite-TTL writes.
- `internal` and `cancel` failures are never cached, even with `shouldCache: () => true`: a cached `internal` hit would lose its exception, and a cancellation belongs to one caller.
- Only GET and HEAD are cached by default. A POST with `cache: true` on the request is still not cached; to cache POST, change `methods` at the plugin level.
- When the cache key is `null` (a per-request `key: false`, or params with an unhashable value such as `FormData`; see the key section), cache passes through: the request is sent as-is, and the cache is neither read nor written. A per-request `cache: { key }` with an explicit key is unaffected and caches as usual.

Operations:

- remove/clear on `api.plugin(cache)`, plus `removeCache` and `clearCache`, return MaybePromise: always await them. Without the plugin the helpers still return false/0.
- `removeCache(client, key)` and `clearCache(client)`: when the client has no cache plugin, they return `false` and `0`.

```ts
axpCache({ expires: 30_000 });
api.get("/list")(undefined, { cache: true }); // uses the plugin-level expires
api.get("/list")(undefined, { cache: 10_000 }); // overrides expires for this call
api.get("/list")(undefined, { cache: { expires: 10_000, key: "pets" } });

const cache = axpCache();
const api2 = createAxp({ plugins: [cache] });
await api2.plugin(cache)?.clear();
```

Store get failures act as misses; set/delete/clear failures are isolated and logged with console.error without changing the response. Async writes are serialized per key and recheck freshness before committing; clear/eject blocks old writes. A slow async store `get`, expiry `delete` or `set` can be cancelled: the call settles as cancelled right away and the late result is not written back. Custom stores own serialization of business/extra data and the persistent encoding of Infinity.

### `axpEnvs(rules)`

Only has a `setup`; no middleware, so it is not in the chain. When installed, it picks the first rule that matches and writes its config into `client.axios.defaults`.

```ts
axpEnvs([
  { rule: () => import.meta.env.DEV, config: { baseURL: "http://dev" } },
  { rule: () => import.meta.env.PROD, config: { baseURL: "http://prod" } },
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

- Computed from method, full URL and params (including defaults.params), plus data for body methods. The URL includes baseURL using axios buildFullPath rules, including allowAbsoluteUrls: false. Use scope for account/tenant isolation.
- Lazy: computed the first time it is needed, then cached on the request object. A request that neither caches nor shares never computes a key.
- Object fields skip only undefined; null fields, empty strings, 0, false, NaN, empty arrays and empty objects all contribute. Primitives carry type tags: `1` differs from `"1"`, and strings are not trimmed. Array order matters; object field order does not. Absent/null top-level params/data adds no corresponding segment.
- Binary bodies up to 64KiB are hashed by content; larger bodies produce no key.
- `Date` and `URLSearchParams` are hashed by content. Values whose content can't be reliably told apart (`FormData`, `Blob`, `Map`, `Set`, other class instances) and objects with circular references produce no key, so those requests are neither cached nor shared. Better to miss than to hit the wrong entry.

Client-level configuration:

| Option  | Default | Description                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scope` | —       | Mixed into every key, e.g. an account id, so cache and share entries never leak across accounts. A string, a number, or a function `(request) => value` returning one of them. A function is evaluated every time a key is computed, so switching accounts doesn't require rebuilding the client. `null`, `undefined`, an empty string and `NaN` add nothing |

```ts
const api = createAxp({ key: { scope: () => session.userId } }); // read the current user each time a key is computed
```

Per-request `key`: omit it to compute automatically; pass a string to use an explicit key (the `scope` is added to it too, and only the empty string counts as `false`; whitespace is preserved); `false` means this request doesn't take part in cache or share. `true` is the same as omitting it (automatic); it is kept so old `key: true, cache: true` code keeps working, but new code can just leave it out. The automatic key includes params.

### Cancellation

- Each logical request has an `AbortController` linked to the caller's `signal`.
- `api.cancelAll(reason?)` aborts every in-flight logical request and returns how many it aborted. Cancelled requests get a result with `api.isCancel(r) === true`.
- `api.pending()` returns the number of in-flight logical requests.
- Retry waits, auth queueing and share followers all respond to cancellation.
- `cancelToken` is no longer supported; use `signal`.

```ts
const controller = new AbortController();
api.get("/list")(undefined, { signal: controller.signal });
controller.abort(); // cancel just this request

api.cancelAll("page left"); // cancel every in-flight request
```

### debug

```ts
createAxp({ debug: true }); // print plugin logs and record call sites for failures
createAxp({ debug: myLogger }); // print through your own logger
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
  readonly enable?: boolean; // false: no setup, not in the chain
  readonly stage?: "outer" | "prepare" | "attempt" | "credential" | "source"; // default 'attempt'; ignored when only taps are given
  readonly enforce?: "pre" | "post"; // default 'post'
  setup?(client): AxpPluginInstance<R, A> | void; // called once per client; keep state here
  handle?: (ctx, next) => Promise<R>; // stateless plugins can pass this directly
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
import type { AxpPlugin } from "@codejoo/axp";

/** Record the duration of each attempt */
const timing: AxpPlugin = {
  name: "timing",
  stage: "attempt",
  async handle(ctx, next) {
    const t = performance.now();
    const r = await next();
    ctx.log.log(`[timing] ${ctx.request.url} ${r.status} ${performance.now() - t}ms`);
    return r;
  },
};

/** The request side and the response side sit at different depths */
const audit: AxpPlugin = {
  name: "audit",
  taps: [
    { stage: "credential", enforce: "post", onRequest: (ctx) => report("send", ctx.request) },
    { stage: "outer", onResponse: (r) => report("done", { ok: r.ok, status: r.status, code: r.code }) },
  ],
};

/** Add a trace header for the inner layers, via next(patch) */
const addTrace: AxpPlugin = {
  name: "add-trace",
  stage: "prepare",
  handle: (ctx, next) => next({ headers: { "X-Trace": crypto.randomUUID() } }),
};
```

A few conventions:

- Middleware doesn't modify `ctx.request`. To change the request for the inner layers, call `next(patch)`. The kernel shallow-merges the patch into a new request, and `headers` is merged one level deeper. A field set to `undefined` in the patch is removed from the request (the same goes for a single header inside `headers`).
- `handle` and `taps` can sit directly on the plugin object (stateless plugins) or be returned from `setup` (stateful plugins). If both are given, the one returned from `setup` wins; they are not merged.
- Keep state in `setup`, not in a closure created by the factory. That way one plugin object can be installed on several clients, and each client gets its own state. `extend` relies on this too.
- `next()` never throws; it always returns an `R`.
- Synthesize failures with `ctx.fail({ failure: AXP_FAILURES.AUTH, reason: "denied", from: r })`; read them with failureOf. Mark replayability before the first send, then check canReplay() before each replay and return the original response when false.

---

## Client API

```ts
function createAxp<S = unknown, R extends IAxpResponse<unknown, string | number> = AxpResponse>(options?: AxpOptions<R>): AxpClient<S, R>;
```

| Option     | Default          | Description                                                    |
| ---------- | ---------------- | -------------------------------------------------------------- |
| `axios`    | `axios.create()` | Underlying instance                                            |
| `plugins`  | `[]`             | Plugin array                                                   |
| `response` | `axpResponse()`  | Response factory. Required when `R` is not `AxpResponse`       |
| `key`      | —                | Key service configuration, see "Kernel features"               |
| `reject`   | `(r) => r`       | Conversion applied to expected failures before they are thrown |
| `debug`    | `false`          | `true`, or a custom logger                                     |

Client members:

| Member                                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.get(path, methodConfig?)(payload?, callConfig?)` and the rest | The 10 lowercase axios verbs. `delete`, `post`, `put` and `patch` send the payload as `data`; the others send it as `params`. For `wrap`, `throws` and `raw`, the call config wins; if it doesn't set them, the method config is inherited                                                                                                                                                                                |
| `api.request<D>(config)`                                           | Untyped escape hatch; also supports `wrap`, `throws` and `raw`                                                                                                                                                                                                                                                                                                                                                            |
| `api.axios`                                                        | The underlying `AxiosInstance`                                                                                                                                                                                                                                                                                                                                                                                            |
| `api.extend(overrides?, { plugins?, axios? }?)`                    | Defaults are cloned into a new axios instance; interceptors are not copied. An explicit axios is used as-is without copying parent defaults. Plugins inherit and setup again; overrides apply afterward at the top level. key/reject/debug/response inherit. See warnings below                                                                                                                                           |
| `api.use(plugin)`                                                  | Installs a plugin; the chain is recompiled                                                                                                                                                                                                                                                                                                                                                                                |
| `api.eject(name)`                                                  | Removes a plugin by name and cleans up its instance; returns whether it was removed. Requests in flight are unaffected and keep the chain they started with                                                                                                                                                                                                                                                               |
| `api.plugin(p)`                                                    | Returns the plugin instance's `api`, such as cache's `clear()`. Pass the plugin object, not its name. Returns `undefined` if it isn't installed                                                                                                                                                                                                                                                                           |
| `api.cancelAll(reason?)` / `api.pending()`                         | See "Cancellation"                                                                                                                                                                                                                                                                                                                                                                                                        |
| `api.inspect()`                                                    | Returns `[{ stage, name }]`, the resolved plugin order                                                                                                                                                                                                                                                                                                                                                                    |
| `api.isResponse(e)` / `api.isCancel(e)`                            | See "Return shape and error handling"                                                                                                                                                                                                                                                                                                                                                                                     |
| `api.dispose()`                                                    | First aborts every in-flight request (they settle with `api.isCancel(r) === true`), then uninstalls the plugins in reverse order of registration and releases resources such as timers. Safe to call more than once; later calls do nothing. A disposed client can't send requests, `use` or `extend` any more. If one plugin throws during cleanup, the others still run, and the first exception is rethrown at the end |

```ts
const admin = api.extend({ baseURL: "/admin" }); // inherits plugins; state is separate
const plain = api.extend({ baseURL: "/v2" }, { plugins: [axpCache()] }); // only the plugins you list
```

---

## Usage warnings and business responses

- Refresh requests made inside `onFailure` / `onRefresh` through the same axp client must set `protected: false`, or use bare axios. Otherwise the refresh queues behind itself. The default 30s refreshTimeout is only a fallback; 0 or Infinity disables it.
- `extend()` creates a new axios instance by default, copying defaults but not interceptors. To preserve interceptors, pass the child a new instance with the same interceptors installed. For example, use a factory to create instances and install the shared interceptors, calling it separately for parent and child (`installInterceptors` below installs those interceptors and returns the instance). Explicit instances do not copy parent defaults; overrides still apply after plugin setup.

  ```ts
  const createTransport = () => installInterceptors(axios.create({ baseURL: "/api" }));
  const api = createAxp({ axios: createTransport() });
  const child = api.extend({ baseURL: "/child" }, { axios: createTransport() });
  ```

  Do not pass the parent's `api.axios` to `extend`: `overrides` (such as `baseURL`) are written into that same instance after plugin setup, changing the parent client's configuration too.

- HTTP 200 with business codes 401, 403, 5xx or 429 does not automatically refresh or retry. The simplest fix is `statusOf`, which maps the business code to an effective status (first example below); you can also configure onFailure, shouldRetry and respectRetryAfter, or write a subclass. Overriding ok alone does not change the plugins' defaults. A complete example follows.
- One-shot bodies (Node streams, ReadableStream, async iterables) are not automatically replayed after sending. Retry/auth/mock return the original response. Custom plugins must check `ctx.canReplay()` before replaying; forcing a replay rethrows the original Error when settling.
- A thrown failure is often kept for a long time by error reporters and query caches. By default it is light (no AxiosError, no raw response, no request body), so that's safe. A `raw: true` copy keeps all of those alive; use it for the calls that need it, not as a global habit.
- If defaults change during an in-flight request, key fields method, baseURL and plain-object params use the entry view plus plugin patches. Other fields without explicit overrides use send-time defaults. The params guarantee applies when defaults.params is a plain object.

This example assumes `{ code, data, message }` business responses with success code 0. The refresh endpoint returns both tokens directly; bare axios sends it outside the axp pipeline.

Simplest form: map the business code to an effective status with `statusOf`, and retry's and auth's default rules just work; `r.status` stays the HTTP status.

```ts
const api = createAxp({
  statusOf: (r) => (r.status === 200 && Number(r.code) !== 0 ? Number(r.code) : r.status),
  plugins: [axpAuth({ tokenManager, onRefresh, onAccessExpired }), axpRetry()],
});
```

To customize each decision, write it out like this:

```ts
import axios from "axios";
import { createAxp, axpAuth, axpRetry, TokenManager, AuthFailureAction, defaultAuthFailure } from "@codejoo/axp";

const transport = axios.create({ baseURL: "/api" });
const tokenManager = new TokenManager();
const businessApi = createAxp({
  axios: transport,
  plugins: [
    axpAuth({
      tokenManager,
      refreshTimeout: 30_000,
      onFailure: (r, tm, ctx) => {
        if (r.status === 200 && Number(r.code) === 401) return tm.accessToken ? AuthFailureAction.Refresh : AuthFailureAction.Expired;
        if (r.status === 200 && Number(r.code) === 403) return AuthFailureAction.Deny;
        return defaultAuthFailure(r, tm, ctx);
      },
      onRefresh: async (_r, tm) => {
        const { data } = await transport.post<{ accessToken: string; refreshToken: string }>("/refresh", { refreshToken: tm.refreshToken });
        tm.set(data.accessToken, data.refreshToken);
      },
      onAccessExpired: () => {
        window.location.href = "/login";
      },
      onAccessDenied: (r) => console.warn(r.message ?? "Forbidden"),
    }),
    axpRetry({
      shouldRetry: (r) => (r.status === 200 ? [408, 429, 500, 502, 503, 504].includes(Number(r.code)) : undefined),
      respectRetryAfter: (r) => [413, 429, 503].includes(r.status === 200 ? Number(r.code) : r.status),
    }),
  ],
});
const result = await businessApi.get("/profile")(undefined, { throws: false });
console.log(result.ok, result.status, result.code, result.data);
```

## Build and test

- `npm test`: unit and integration tests (`test/**`).
- `npm run build`: produces the unbundled ESM with type declarations, and the minified bundle for `./min`. The layout is described in the next section.
- `npm run e2e`: Playwright end-to-end tests in a real browser (`e2e/`), against a local mock server.
- `npm run accept`: black-box acceptance against the [api-ws-demo testkit](https://github.com/icodejoo/api-ws-demo/tree/main/testkit). A real HTTP server behind a network-condition proxy, run across scenario, network, response style and adapter combinations.

### Output and subpaths

`npm run build` fills `dist/` (git-ignored, shipped in the package) with two builds, both targeting ES2015:

- `dist/esm/`: unbundled ESM, one `.mjs` and one `.d.mts` per source file. Only the entries in the table below are public; every other file here is an internal module that the entries import.
- `dist/index.min.js`: the single minified file behind `./min`. It has no declarations of its own and uses `dist/esm/index.d.mts`.

`exports` in `package.json` lists 13 subpaths:

| Subpath                                                                                   | Resolves to                   | Exports                                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `.`                                                                                       | `dist/esm/index.mjs`          | The root entry, listed below                                                       |
| `./min`                                                                                   | `dist/index.min.js`           | Same names as the root entry, in one minified file with its own module instance    |
| `./auth`                                                                                  | `dist/esm/plugins/auth.mjs`   | `axpAuth` as the default export, plus `AuthFailureAction` and `defaultAuthFailure` |
| `./cache`                                                                                 | `dist/esm/plugins/cache.mjs`  | `axpCache` as the default export, plus `removeCache` and `clearCache`              |
| `./envs`, `./filter`, `./loading`, `./mock`, `./notify`, `./repath`, `./retry`, `./share` | `dist/esm/plugins/<name>.mjs` | The plugin factory as the default export                                           |
| `./package.json`                                                                          | `package.json`                | The manifest                                                                       |

Nothing else can be imported; Node answers `ERR_PACKAGE_PATH_NOT_EXPORTED`. That covers the internal algorithm modules (`retry-timing`, `auth-match`, `cache-store`) and the removed `./cancel`, `./key`, `./logger` and `./normalize`, whose features now live in the kernel.

A plugin subpath and the root entry hand out the same function, so mixing them is safe. `./min` is a separate copy: `instanceof AxpResponse` fails across the two, so tell responses apart with `isAxpResponse` or `api.isResponse`.

The root entry (and `./min`) exports:

- `createAxp`: the client factory.
- Responses: `AxpResponse`, `axpResponse`, `isAxpResponse`, `AXP_RESPONSE` (the brand, `Symbol.for("axp.response")`), `AXP_FAILURE`, `AXP_FAILURES`, `failureOf`, `isAxpCancel` and `nativeOf` (reads the `raw` / `error` / `request` off a thrown `raw: true` copy).
- `stateKey`: creates the typed keys for `ctx.get` and `ctx.set`, the per-request state of custom plugins.
- `TokenManager`: the default token store for `axpAuth`.
- Plugin factories: `axpLoading`, `axpNotify`, `axpRepath`, `axpFilter`, `axpEnvs`, `axpRetry`, `axpAuth`, `axpMock`, `axpShare` and `axpCache`.
- `AuthFailureAction` and `defaultAuthFailure`, for `axpAuth`'s `onFailure`.
- `removeCache` and `clearCache`, for `axpCache`.
- Types: every public type, such as `AxpClient`, `AxpPlugin`, `AxpRequestConfig`, `IAxpResponse`, `WithData` and `WithNative`.
