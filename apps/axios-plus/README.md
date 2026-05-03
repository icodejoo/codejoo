# http-plugins

[中文](./README.zh-CN.md) | English

A type-driven, plugin-based HTTP client built on `axios`. OpenAPI codegen output (`model.PathRefs`) drives URL autocomplete + request/response inference; a dozen built-in plugins compose freely by `use` order, while business code only ever sees a single settle shape: `ApiResponse`.

---

## Design contract: normalize-first / rethrow-last

Built around the "end-to-end normalization + onFulfilled-only path + tail-resolved reject" model:

1. **`normalize` MUST be `use`d first** — collapses every axios settle shape (success / HTTP error / network / timeout / cancel / business error) into `response.data: ApiResponse` and **resolves**. All settle paths run through onFulfilled.
2. **Middle plugins live on the onFulfilled path** — they read `response.data: ApiResponse`, never do shape detection or write `try/catch`.
3. **`rethrow` last** — decides whether to `reject` the `ApiResponse` to business callers based on `apiResp.success`.
4. **Install-time dependency check** — `retry` / `rethrow` / `notification` / `auth` call `requirePlugin('normalize')` during install; missing it throws immediately.

Business-side error handling reduces to one shape:

```ts
try {
  const r = await api.get('/x')();   // r is always a successful ApiResponse
  renderPet(r.data);
} catch (apiResp) {                  // always an ApiResponse (thrown by rethrow)
  if (apiResp.code !== ERR_CODES.CANCEL) toast(apiResp.message);
}
```

---

## Quick start

```bash
pnpm install
```

```ts
import axios from 'axios';
import { create, ERR_CODES } from 'http-plugins';
import normalizePlugin from 'http-plugins/plugins/normalize';
import rethrowPlugin   from 'http-plugins/plugins/rethrow';

const api = create<model.PathRefs>(
  axios.create({ baseURL: 'https://api.example.com' }),
  { debug: true },
);

api.use([
  normalizePlugin({ success: (r) => r.code === '0000' }),
  rethrowPlugin(),
]);

// path autocomplete + request/response inference
const findByStatus = api.get('/pet/findByStatus');
const pets = await findByStatus({ status: 'available' });
//    ^? model.Pet[]
```

Without a schema generic, the client degrades to a thin axios wrapper: paths accept any string, request/response default to `unknown`.

---

## Recommended `use` order

```ts
api.use([
  // ① must be first — normalize every settle shape
  normalizePlugin({ success: (r) => r.code === '0000' }),

  // request side (no strict order requirement)
  filterPlugin(), reurlPlugin(), keyPlugin(), cancelPlugin(),
  envsPlugin([/* ... */]), mockPlugin({ baseURL: '/__mock__' }),

  // adapter wrapping (later use ⇒ outermost ⇒ runs first; cache hit short-circuits everything)
  cachePlugin({ stt: 60_000 }),
  sharePlugin(),
  concurrencyPlugin({ max: 6 }),
  loadingPlugin({ loading: showSpinner }),

  // response side (FIFO — earlier use sees the response first)
  retryPlugin({ max: 3 }),
  notificationPlugin({ notify: toast.error }),
  authPlugin({ tokenManager, protected: ['/admin/*'] }),

  // ② must be last — decides reject based on apiResp.success
  rethrowPlugin(),
]);
```

> **Order semantics**: native axios — request interceptors LIFO (later `use` runs first), response interceptors FIFO (earlier `use` runs first), adapter overrides previous on later `use`. See [`src/plugin/`](./src/plugin/) for the PluginManager docs.

---

## Built-in plugins

Each plugin lives at [`src/plugins/<name>/`](./src/plugins/) with its own README covering full options, normalization matrices, and division of labor with neighbours. The table below only lists **purpose** + **core options**.

| Plugin | Purpose | Core options |
|---|---|---|
| [`normalize`](./src/plugins/normalize/) | End-to-end normalization to `ApiResponse`; always resolves | `success(apiResp) => boolean` (required); `{code,message,data}KeyPath` for envelope field paths |
| [`rethrow`](./src/plugins/rethrow/) | Tail-side `reject` driven by `apiResp.success` | `shouldRethrow(apiResp)`, `transform(apiResp)` to rewrite the rejected value |
| [`key`](./src/plugins/key/) | Stable request fingerprint (FNV-1a hash) — joining dimension for cache / share / retry | `dimensions: ['method','url','params','data']` |
| [`cache`](./src/plugins/cache/) | Adapter-layer TTL response cache; hit returns synchronously without HTTP | `stt` (TTL ms), `storage` (default sessionStorage), `give(resp)` to pick what to cache |
| [`share`](./src/plugins/share/) | Same-key concurrent dedup | `policy: 'start' \| 'end' \| 'race' \| 'none'` |
| [`concurrency`](./src/plugins/concurrency/) | In-flight cap + FIFO priority queue | `max`; per-request `priority` / `concurrency:false` to bypass |
| [`loading`](./src/plugins/loading/) | Global ref-counted loading: first triggers `cb(true)`, all settled triggers `cb(false)` | `loading: (visible: boolean) => void` |
| [`cancel`](./src/plugins/cancel/) | Auto-injects `AbortController`; `cancelAll(ax)` aborts every in-flight | none; optional url / method allow/deny lists |
| [`retry`](./src/plugins/retry/) | Failure retry + exponential backoff + `Retry-After` parsing + jitter | `max`, `methods` / `status` (merged with defaults), `shouldRetry(ctx)`, `beforeRetry(ctx)` |
| [`notification`](./src/plugins/notification/) | Toast on failure; routes copy by code / status | `notify(msg)`, `messages: { [code]: string }` |
| [`auth`](./src/plugins/auth/) | Token + 401/403 auto-refresh; concurrent-refresh protocol; stale-token replay | `tokenManager`, `methods`/`urlPattern`/`isProtected`, `onFailure → AuthFailureAction`, `onRefresh`, `onAccessExpired` |
| [`filter`](./src/plugins/filter/) | Strip `null` / `undefined` / `NaN` / blank fields from `params` / `data` | `predicate(value, key)` to customize keep rule |
| [`reurl`](./src/plugins/reurl/) | Replace `:id` / `{id}` / `[id]` from `params` / `data`; normalize the slash between `baseURL` and `url` | `removeKey: true` to drop the consumed field; `fixSlash: true` to normalize separators |
| [`mock`](./src/plugins/mock/) | In dev, rewrite url to a mock server | `baseURL`, `enabled` (global toggle or per-request opt-in) |
| [`envs`](./src/plugins/envs/) | At install time, pick `axios.defaults` by rule (DEV / PROD / staging) | `envs: IEnvRule[]`, `pick(env) => index` |

---

## Custom plugins

```ts
import type { Plugin } from 'http-plugins';

const logging: Plugin = {
  name: 'logging',
  install(ctx) {
    ctx.request((cfg)  => { ctx.logger.log('→', cfg.method, cfg.url);   return cfg;  });
    ctx.response((res) => { ctx.logger.log('←', res.status, res.config.url); return res; });
    ctx.cleanup(() => ctx.logger.log('ejected'));
  },
};

api.use(logging);
api.eject('logging');     // interceptors / adapter / transforms / cleanups all roll back
```

`ctx` API reference, lifecycle, `extends` for child Cores, `runWhen` conditional interceptors, and other advanced topics live in [`src/plugin/README.md`](./src/plugin/README.md).

---

## Iterating against unreleased endpoints — extending `model.PathRefs`

`types/paths.d.ts` is a codegen artifact; never edit it by hand. Register temporary paths via TypeScript **declaration merging** under [`types/local/`](./types/local/) — see the template [`types/local/example.d.ts.template`](./types/local/example.d.ts.template). Once an endpoint ships, drop the entry; conflicts surface as TS compile errors, so paths can't drift silently.

---

## Three response shapes

```ts
const post = api.post('/pet');

await post(payload);                    // Promise<Pet>            — unwrapped data
await post(payload, { raw: true });     // Promise<{code,data,message?}>
await post(payload, { wrap: true });    // Promise<ApiResponse<Pet>>
```

---

## Error-code constants

```ts
import { ERR_CODES } from 'http-plugins';
// ERR_CODES.HTTP    'HTTP_ERR'    HTTP 4xx/5xx without server envelope
// ERR_CODES.NETWORK 'NETWORK_ERR' offline / DNS / connection refused
// ERR_CODES.TIMEOUT 'TIMEOUT_ERR' ETIMEDOUT / ECONNABORTED
// ERR_CODES.CANCEL  'CANCEL'      user-initiated cancel
```

---

## License

MIT
