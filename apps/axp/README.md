# http-plugins

[中文](./README.zh-CN.md) | English

A typed, plugin-based HTTP client built on `axios`. The schema (`model.PathRefs`,
emitted by codegen from your OpenAPI spec) drives end-to-end inference of
request payloads, response bodies, and URL autocomplete.

## Full usage example

```ts
import axios from 'axios';
import { create, type Plugin } from 'http-plugins';

/* 1) Wrap an axios instance and bind your schema. ----------------------- */
const api = create<model.PathRefs>(
  axios.create({ baseURL: 'https://api.example.com' }),
  { debug: true },
);

/* 2) Make typed calls — path / payload / response are all inferred. ----- */
const findByStatus = api.get('/pet/findByStatus');
const pets = await findByStatus({ status: 'available' });
//    ^? model.Pet[]

const addPet = api.post('/pet');
await addPet({ name: 'lassie', photoUrls: [] });                  // → Pet
await addPet({ name: 'lassie', photoUrls: [] }, { raw: true });   // → { code, data: Pet, message? }
await addPet({ name: 'lassie', photoUrls: [] }, { wrap: true });  // → ApiResponse<Pet>

/* 3) Build single-purpose plugins. Every ctx.* side-effect is auto-tracked
 *    and reverted on eject — no manual cleanup boilerplate. ----------------- */
const authRequest: Plugin = {
  name: 'auth-request',
  install(ctx) {
    ctx.request((cfg) => {
      cfg.headers.set('Authorization', `Bearer ${getToken()}`);
      return cfg;
    });
  },
};

const authResponse: Plugin = {
  name: 'auth-response',
  install(ctx) {
    ctx.response(undefined, async (err) => {
      if (err.response?.status === 401) await refresh();
      return Promise.reject(err);
    });
  },
};

const logging: Plugin = {
  name: 'logging',
  install(ctx) {
    ctx.request((cfg) => { ctx.logger.log('→', cfg.method, cfg.url); return cfg; });
    ctx.response((res) => { ctx.logger.log('←', res.status, res.config.url); return res; });
  },
};

/* 4) Install in the order you want them to run. axios's native semantics:
 *      • request:  LIFO  (last `use`d runs first)
 *      • response: FIFO  (first `use`d runs first)
 *    No priority field — order is your call. ------------------------------- */
api.use(logging).use(authRequest).use(authResponse);
api.plugins();             // PluginRecord[] snapshot for debugging
api.eject('auth-request'); // tears down its interceptors / transforms / adapter / cleanup
```

---

## Quick start

```bash
pnpm install
```

```ts
import axios from 'axios';
import Core, { create } from './src/core';

// Bind a schema and you get full inference
const api = create<model.PathRefs>(
  axios.create({ baseURL: 'https://api.example.com' })
);

// Path autocomplete is filtered by HTTP verb
const findByStatus = api.get('/pet/findByStatus');
const pets = await findByStatus({ status: 'available' });
//    ^ Pet[]
```

If you don't bind a schema, the client behaves like a thin axios wrapper —
paths accept any string, payload/response default to `unknown`.

```ts
const api = create();              // T = unknown
const get = api.get('/whatever');  // OK, no schema
const r = await get<MyType>();     // explicit generics still work
```

---

## Three response shapes

Every dispatched call has three flavours, picked by the config flag:

| Config flag       | Return type                                        |
|-------------------|----------------------------------------------------|
| `{ raw: true }`   | `Promise<{ code, data: R, message? }>` (full envelope) |
| `{ wrap: true }`  | `Promise<ApiResponse<R>>`                          |
| (omitted)         | `Promise<R>` (unwrapped data)                      |

```ts
const post = api.post('/pet');

await post(payload);                     // Pet
await post(payload, { raw: true });      // { code, data: Pet, message? }
await post(payload, { wrap: true });     // ApiResponse<Pet>
```

`R` is inferred from `model.PathRefs`. Pass an explicit generic to override
either the response or the payload at the call site:

```ts
await post<{ ok: true }, { custom: string }>({ custom: 'x' });
```

---

## Extending `model.PathRefs` during integration

The schema in `types/paths.d.ts` is **codegen-owned** — never edit it by hand.
When you need to call an endpoint the codegen hasn't shipped yet, register it
through TypeScript declaration merging.

1. Drop a new file under `types/local/`, e.g. `types/local/draft.d.ts`:

   ```ts
   declare namespace model {
     interface PathRefs {
       '/pet/draft': {
         post: [response: model.Pet, request: [payload: model.req.AddPet]];
       };
       '/experimental/whatever': {
         // No payload, response not yet known — `unknown` forces a cast at the call site
         get: [response: unknown, request: []];
       };
     }
   }
   ```

2. The path is now visible to autocomplete and inference everywhere.

3. **Delete the entry** once the official codegen output covers it. Conflicts
   between the two declarations would surface as a TS error, so you can't
   silently drift.

A template is included at [`types/local/example.d.ts.template`](./types/local/example.d.ts.template).

> **Why declaration merging instead of a `(string & {})` escape hatch?**
> Strict path typing prevents typos and dead URLs. A merge file is grep-able,
> reviewable, and forces in-progress endpoints to be registered as first-class
> citizens — once shipped, deleting them from `types/local/` is a one-line PR.

---

## Plugins

Plugins extend axios — adapter, interceptors, request/response transformers,
custom side-effects — through a single `install(ctx)` entry. Every side-effect
performed via `ctx` is **auto-tracked** and reverted on `core.eject(name)`, so
plugin authors never write cleanup boilerplate.

### Anatomy

```ts
import type { Plugin } from './src/types';

const auth: Plugin = {
  name: 'auth',           // unique id, reused by core.eject()
  install(ctx) {
    // ctx.axios — direct access for anything ctx doesn't cover
    // ctx.logger — tagged logger (blue chip), no-op when debug is off
    // ctx.name — echoes plugin.name

    ctx.request((config) => {
      config.headers.set('Authorization', `Bearer ${getToken()}`);
      return config;
    });

    ctx.response(
      (res) => res,
      (err) => Promise.reject(err),
    );

    ctx.adapter(myFetchAdapter);
    ctx.transformRequest(serialize);
    ctx.transformResponse(parse);

    const timer = setInterval(refresh, 60_000);
    ctx.cleanup(() => clearInterval(timer));

    // optional: an extra cleanup callback may be returned
    return () => console.log('also runs on eject');
  },
};
```

> **One plugin, one job.** There is no priority field — order is decided by
> the caller via `use()`. Splitting cross-cutting concerns into single-purpose
> plugins (e.g. `auth-request` vs `auth-response`) makes the call site the
> single source of truth for execution order.

### `PluginContext` API

Every method below auto-registers its side-effect against the current
install, so `core.eject(plugin.name)` reverts everything you did. The only
exception is `ctx.axios` — that's a live handle and anything you mutate
through it bypasses tracking.

| Member | Signature | Reverted on eject? |
|---|---|---|
| `ctx.axios` | `AxiosInstance` | — (escape hatch, read-only by convention) |
| `ctx.name` | `string` | — (echo of `plugin.name`) |
| `ctx.logger` | `PluginLogger` | — (tagged logger; no-op unless `debug`) |
| `ctx.request(onF?, onR?, opts?)` | adds a request interceptor | ✓ `interceptors.request.eject(id)` |
| `ctx.response(onF?, onR?)` | adds a response interceptor | ✓ `interceptors.response.eject(id)` |
| `ctx.adapter(a)` | replaces `axios.defaults.adapter` | ✓ original restored |
| `ctx.transformRequest(...fns)` | appends to `axios.defaults.transformRequest` | ✓ appended fns are spliced out |
| `ctx.transformResponse(...fns)` | appends to `axios.defaults.transformResponse` | ✓ appended fns are spliced out |
| `ctx.cleanup(fn)` | registers a non-axios teardown callback | ✓ `fn()` invoked |
| `install(ctx) => PluginCleanup` | optional return value | ✓ invoked **before** `ctx.cleanup` callbacks |

#### Interceptors

`ctx.request` / `ctx.response` signatures match
`axios.interceptors.{request,response}.use` exactly — return the (possibly
async) `config` / `response`, or `throw` / `Promise.reject` to propagate an
error down the chain.

```ts
ctx.request(
  (cfg) => { cfg.headers.set('X-Trace-Id', traceId()); return cfg; },
  (err) => Promise.reject(err),
  { synchronous: true, runWhen: (cfg) => cfg.url?.startsWith('/v2/') ?? false },
);
```

The third argument is axios's `AxiosInterceptorOptions`:

- **`runWhen(config) => boolean`** — skip this interceptor when the predicate
  is `false`. Useful when one plugin should only fire on a subset of routes.
- **`synchronous: true`** — opt into axios's synchronous fast path. Only safe
  when *every* interceptor in the chain (and the adapter) is synchronous.

`ctx.response` doesn't take options — that's an axios limitation, not ours.

#### Cleanup channels

There are two ways to register a teardown callback:

```ts
install(ctx) {
  const timer = setInterval(refresh, 60_000);
  ctx.cleanup(() => clearInterval(timer));   // (a) inline registration

  return () => abortAllInflight();           // (b) install return value
}
```

Both run on eject. Order:

1. The `install` return value (if any).
2. `ctx.cleanup` callbacks in registration order.
3. Interceptors are ejected.
4. Adapter is restored.
5. Transforms are spliced out.

Each cleanup is wrapped in `try/catch` — a throwing callback only logs via
the plugin's tagged logger and never aborts subsequent steps.

### Authoring guide

#### Don't bypass `ctx`

```ts
install(ctx) {
  // ✗ wrong — registered straight on the live axios instance.
  //   Not tracked; survives core.eject('my-plugin').
  ctx.axios.interceptors.request.use(myInterceptor);

  // ✓ right — auto-tracked, ejected on teardown.
  ctx.request(myInterceptor);
}
```

Use `ctx.axios` only for read-only inspection (e.g. checking
`defaults.baseURL`) or for surface area `ctx` doesn't cover. Anything you
mutate there is your responsibility to undo — typically inside a
`ctx.cleanup` callback.

#### State lives in the install closure

`install` runs fresh on every install — including the implicit re-installs
that `use` / `eject` triggers for the rest of the plugin set. Keep
plugin-local state in the closure; reach for module-level variables only
when you *want* state to survive eject.

```ts
function createRetry(max = 3): Plugin {
  return {
    name: 'retry',
    install(ctx) {
      const attempts = new WeakMap<object, number>();   // fresh each install
      ctx.response(undefined, async (err) => {
        const cfg = err.config;
        const n = (attempts.get(cfg) ?? 0) + 1;
        if (n > max) return Promise.reject(err);
        attempts.set(cfg, n);
        await new Promise(r => setTimeout(r, 100 * n));
        return ctx.axios.request(cfg);
      });
    },
  };
}
```

#### Error handling

- **`install` throws** — the manager runs teardown for the partially-
  installed record (so anything tracked so far is reverted), removes it from
  `_plugins`, and re-throws to the `use()` caller. Previously-installed
  plugins are untouched.
- **A cleanup callback throws** — caught and logged; the next callback still
  runs.
- **Duplicate `name` on `use`** — emits a `console.warn` (always, even when
  `debug: false`) and silently ignores the duplicate call. The first install
  wins; if you want to swap, `eject` the existing one first. The warning
  channel is independent of the `debug` flag because a duplicate registration
  is a developer-visible bug, not a debug-only event.

#### Plugin factory pattern

Plugins are plain values, but most non-trivial ones want options. The
convention is a factory function that returns a `Plugin`:

```ts
import type { Plugin } from 'http-plugins';

export interface RetryOptions { max?: number }

export function retry(options: RetryOptions = {}): Plugin {
  const max = options.max ?? 3;
  return {
    name: 'retry',
    install(ctx) { /* ... */ },
  };
}

api.use(retry({ max: 5 }));
```

This keeps options closed over in the factory's closure (one source of
truth) and lets the install body stay focused on side-effects.

#### Eject by factory reference

`core.eject` accepts three equivalent forms — all collapse to a single
string-name lookup internally:

```ts
core.eject('retry');         // by name
core.eject(retryPlugin);     // by Plugin object  → uses plugin.name
core.eject(retry);           // by factory function → uses factory.name
```

The factory form relies on a **convention**: the factory's `.name` must
match the `name` of the `Plugin` it returns. JS sets `function foo() {...}`'s
`.name` to `'foo'` automatically, so the convention is free *if* the
declaration name and the plugin name agree. When they don't (e.g. the plugin
name is kebab-case but the factory is camelCase), assign explicitly:

```ts
const name = 'http-normalize-response';
export default function normalize(opts: NormalizeOptions = {}): Plugin {
  return { name, install(ctx) { /* ... */ } };
}
normalize.name = name;   // ← keeps factory.name === plugin.name

api.use(normalize());
api.eject(normalize);    // ← works because of the line above
```

Because all three forms boil down to the same string, there's only one
removal path inside `PluginManager.eject(name)` — no separate
`ejectByFactory`, no factory→plugin map, no extra runtime state. If
`factory.name` doesn't match any installed plugin, `eject` is a silent
no-op (same as passing an unknown string).

### Lifecycle

`use` accepts either a single plugin or an array; both forms return `this`
for chaining, and both can be freely mixed:

```ts
import { create } from './src';

const api = create<model.PathRefs>(undefined, { debug: true });

api
  .use(authRequest)               // install — ctx.* side-effects recorded
  .use([logging, authResponse]);  // batch install — one #refresh for the whole array

api.plugins();          // → snapshot: name, interceptor counts, etc.
api.eject('auth-request');  // teardown: interceptors ejected, adapter restored,
                            // transforms spliced out, cleanup callbacks run
api.use(authRequest);   // re-install — full re-registration in `use()` order
```

The array form is **atomic with respect to `#refresh`**: every plugin in
the batch is queued before any install runs, and the interceptor stack is
rebuilt exactly once at the end. This matters when you install N plugins
together — `N` calls to `use(p)` would refresh the stack `N` times (each
refresh tears down and reinstalls everything), whereas `use([...])` keeps
the cost linear.

Duplicate detection still applies inside the batch: if you pass the same
plugin twice in one array, or pass a plugin that's already installed, you
get the same `console.warn` and silent skip as the single-plugin form.

`use` and `eject` always trigger a full re-install of the remaining plugin set
in `use()` order. This guarantees that the axios interceptor stack precisely
mirrors the current plugin list — no stale handlers, no order drift when a
plugin in the middle of the chain is removed.

### Extends — deriving a child `Core`

`api.extends(overrides)` returns a fresh `Core<T>` that starts as a clone of
the parent and then applies `overrides` on top of the cloned axios defaults.
Parent and child share **plugin objects by reference** but have **independent
axios instances**, **independent interceptor stacks**, and **independent
`PluginManager` records**. After the call they evolve in isolation.

```ts
const api = create<model.PathRefs>(
  axios.create({ baseURL: 'https://api.example.com' }),
  { debug: true },
).use([auth, retry, logging]);

const v2 = api.extends({ baseURL: 'https://api.example.com/v2' });
// v2 starts with the same auth + retry + logging stack and the same axios
// defaults; only baseURL differs. Subsequent v2.use(...) / v2.eject(...)
// don't touch api.
```

#### Field-by-field clone strategy

Not every field can be deep-copied (functions, sinks) and not every field can
be shallow-shared (mutable arrays, headers). The split:

| Field | Strategy | Why |
|---|---|---|
| `headers` | **deep** (one level into the per-method nested object, or `new AxiosHeaders(h)`) | `AxiosHeaders.set` / per-method tables are mutated in place; sharing would let the child's defaults leak into the parent |
| `transformRequest` / `transformResponse` | **deep** (fresh array via `asArray`) | Plugins `push` into these via `ctx.transformRequest`; a shared array means the child's transforms execute on the parent's requests |
| `params` | **deep** (`{ ...params }`) | Default query bag is mutated in place by user code |
| `transitional` | **deep** (`{ ...transitional }`) | Cheap, and consistent with the rest of the mutable-bag fields |
| `adapter` | **shared by reference** | Function — immutable from the consumer side; replacing it is `defaults.adapter = next`, not `mutate(adapter)` |
| Primitives (`baseURL`, `timeout`, `withCredentials`, …) | **shared by value** | Trivially safe — assignment replaces, never mutates |
| `CoreOptions.logger` | **shared by reference** | Sink. Multiple Cores writing the same `console` (or your logger backend) is the design intent |
| Plugin **objects** in the list | **shared by reference** | `{ name, install }` is stateless — `install` builds a fresh closure on each call. Sharing the same plugin across N Cores is correct |
| Plugin **list** (the array itself) | **deep** (`[...parent.plugins]`) | Otherwise `child.use(p)` would also mutate the parent's `#plugins` array |
| `axios.interceptors`, `PluginManager` records / id arrays | **not copied** | These are runtime state, not config — rebuilt on the child by replaying `useMany` |

#### Why bother

- **Multi-context projects** — main API + third-party API + internal admin
  API often share auth/retry/loading but differ in `baseURL` / headers.
  `extends` makes the relationship explicit instead of recreating the stack
  by hand and risking order drift.
- **Atomicity** — the plugin list is replayed via a single `useMany([...])`,
  so the child's interceptor stack is built in one `#refresh` cycle, not N.
- **Tests** — derive a `mockApi = api.extends({})` and `eject` the real
  adapter / `use` a mock adapter on the child, leaving production `api`
  untouched.

If your project only ever needs one `Core` instance, you don't need this
API — the value comes from "many independent but configurationally similar
clients".

### Order semantics

`use()` order **is** axios's registration order. From there, axios's native
serial execution model takes over:

```
use() order   request flow (LIFO)        response flow (FIFO)
─────────────  ─────────────────────────  ─────────────────────────
api.use(A)   ↓  inner: runs last          inner: runs first      ↑
api.use(B)   │  middle                    middle                 │
api.use(C)   ↓  outer: runs first         outer: runs last       ↑
```

- **Request interceptors** run last-registered-first. Need a plugin to touch
  the config *before* others? `use()` it last.
- **Response interceptors** run first-registered-first. Need a plugin to see
  the response *before* others? `use()` it first.
- **`transformRequest` / `transformResponse`** run in append order — first
  `use()`d transforms first.
- **`adapter`** — last `use()` wins; previous adapter is restored on `eject`.

Because the two sides have opposite execution direction, a plugin that needs
*both* "early on request" and "early on response" must be split into two —
one `use()`d last (for request), one `use()`d first (for response).

### Recipes

#### Auth — attach token + auto-refresh on 401

Two single-purpose plugins; the call site picks the order.

```ts
const authRequest: Plugin = {
  name: 'auth-request',
  install(ctx) {
    ctx.request((cfg) => {
      const t = tokenManager.accessToken;
      if (t) cfg.headers.set('Authorization', `Bearer ${t}`);
      return cfg;
    });
  },
};

const authResponse: Plugin = {
  name: 'auth-response',
  install(ctx) {
    let pending: Promise<void> | null = null;       // de-dup concurrent refresh
    ctx.response(undefined, async (err) => {
      if (err.response?.status !== 401 || !tokenManager.canRefresh) {
        return Promise.reject(err);
      }
      pending ??= refresh().finally(() => (pending = null));
      await pending;
      return ctx.axios.request(err.config);          // retry once with new token
    });
  },
};

api.use(authResponse)   // FIFO ⇒ runs first on response → catches 401
   .use(authRequest);   // LIFO ⇒ runs first on request → attaches header
```

#### Loading indicator — request count

```ts
const loading: Plugin = {
  name: 'loading',
  install(ctx) {
    let count = 0;
    const inc = () => { if (++count === 1) showSpinner(); };
    const dec = () => { if (--count === 0) hideSpinner(); };

    ctx.request((cfg) => { if (cfg.loading !== false) inc(); return cfg; });
    ctx.response(
      (res) => { if (res.config.loading !== false) dec(); return res; },
      (err) => { if (err.config?.loading !== false) dec(); return Promise.reject(err); },
    );

    ctx.cleanup(() => { count = 0; hideSpinner(); });   // safety net on eject mid-flight
  },
};
```

#### Conditional interceptor — `runWhen`

Skip a route entirely without writing branching logic in the handler.

```ts
const idempotency: Plugin = {
  name: 'idempotency',
  install(ctx) {
    ctx.request(
      (cfg) => { cfg.headers.set('Idempotency-Key', crypto.randomUUID()); return cfg; },
      null,
      { runWhen: (cfg) => cfg.method === 'post' && !cfg.url?.startsWith('/auth/') },
    );
  },
};
```

#### Custom adapter — mock in tests

```ts
const mockAdapter: Plugin = {
  name: 'mock-adapter',
  install(ctx) {
    ctx.adapter(async (config) => {
      const fixture = await loadFixture(config.url!);
      return { data: fixture, status: 200, statusText: 'OK', headers: {}, config };
    });
  },
};

if (import.meta.env.MODE === 'test') api.use(mockAdapter);
```

`api.eject('mock-adapter')` restores the original adapter — handy when you
want to flip between mocked and real network mid-test.

### Debugging

`new Core(axios, { debug: true })` (or `create(_, { debug: true })`) routes a
tagged logger through every plugin action — install, eject, each interceptor
add/remove, adapter swap, transform append. The tag (`[http-plugins]` /
`[http-plugins] [<plugin>]`) is rendered with a **blue background, white
foreground** pill — `%c` CSS in DevTools, ANSI SGR (`\x1b[44;97m`) in Node
terminals — so it visually pops in a noisy console:

```
[http-plugins] use "auth-request"
[http-plugins] [auth-request] request interceptor #0 +
[http-plugins] use "auth-response"
[http-plugins] [auth-response] response interceptor #0 +
[http-plugins] use "http-normalize"
[http-plugins] [http-normalize] response interceptor #1 +
[http-plugins] eject "auth-request"
[http-plugins] [auth-request] -1 request interceptor
```

Replace the sink via `{ debug: true, logger: myLogger }` (any object with
`log/warn/error`). For runtime introspection without enabling debug, call
`core.plugins()` — returns a `PluginRecord[]` snapshot per installed plugin.

### Bundled plugins

| Plugin | Description |
|---|---|
| [`normalize`](./src/plugins/normalize.ts) | Promotes `response.data.data` to `response.data` (envelope unwrap) |
| [`normalizeStrict`](./src/plugins/http-normalize-plugin.ts) | Wraps the body in `ApiResponse`, rejects when `successful === false` |

---

## Architecture

```
src/
├── core.ts              # `Core<T>` class + `create()` factory + dispatch glue
├── plugin.ts            # `PluginManager` — install/eject lifecycle, axios
│                        # interceptor / transform / adapter side-effect tracking
├── helper.ts            # Shared utilities (loggers, `asArray`, `tagged`, NS)
├── types.ts             # All type machinery + the `HttpPrototype<T>` helper
├── objects/             # Runtime model classes
└── plugins/             # Bundled plugins

types/
├── paths.d.ts           # Codegen — DO NOT EDIT
├── request.d.ts         # Codegen — DO NOT EDIT
├── response.d.ts        # Codegen — DO NOT EDIT
└── local/               # Hand-written extensions (declaration merging)
```

`Core<T>` consumes a single high-level helper, `HttpPrototype<T>`, exported
from `src/types.ts`. Internally it derives a method-major view of the schema
(`_Indexed<T>`) so per-call lookups are O(1) literal access instead of
filtering across all 1000+ paths on every IntelliSense hover.

### Type-perf knobs already applied

- Method-major inversion (`_Indexed<T>`) is computed once per `T`, then cached
  by the compiler. Every `core.<verb>(path)` call site does a direct property
  lookup on the inversion.
- Strict path typing — no `(string & {})` literal escape — keeps autocomplete
  unions narrow and rendering fast.
- Non-distributive `[X] extends [Y]` guards prevent fan-out across union members.
- Three dispatch overloads share a single resolved-payload/response inference
  via the captured literal `P`.

If your schema grows past ~1000 paths and IDE responsiveness suffers, consider
splitting it across multiple `Core<DomainRefs>` instances (one per business
domain). See the perf discussion in PR history for details.

---

## API reference

### `create<T = unknown>(axiosInstance?): Core<T>`

Factory that wraps an `axios` instance. Pass the schema generic to opt into
typed paths.

### `class Core<T = unknown>`

Exposes one method per HTTP verb (`get`, `post`, `put`, `delete`, `patch`,
`head`, `options`). Each takes `(path, config?)` and returns a dispatch function.

### Dispatch overloads

```ts
fn(payload?, config?)                       → Promise<R>
fn(payload?, { ...config, raw: true })      → Promise<{ code, data: R, message? }>
fn(payload?, { ...config, wrap: true })     → Promise<ApiResponse<R>>
```

`payload` is required, optional, or absent depending on the schema entry's
`request` tuple (`[Payload]`, missing, or `[]` respectively).

### Types

The full type surface lives in [`src/types.ts`](./src/types.ts). The only
externally meaningful exports are:

- `HttpPrototype<T>` — the prototype shape for a `Core<T>` instance
- `HttpMethodLower` — `'get' | 'post' | ...`
- `Plugin`, `HttpPluginsBaseOptions`, `HttpPluginsMethodOptions`,
  `HttpPluginsRuntimeOptions`, `NormalizeOptions`

---

## License

MIT
