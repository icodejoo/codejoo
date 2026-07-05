---
name: codejoo-axp
description: Use when working in apps/axp (@codejoo/axp) — a typed, plugin-based HTTP client over axios. Core wraps an axios instance and dispatches verb calls into three response shapes; PluginManager auto-tracks/reverts every ctx side-effect; bundled plugins cover reqkey, cache, share, retry, loading, auth, mock, reqclean, normalize-response, repath, envs, cancel. Covers architecture, the hard-won invariants (esp. axios mergeConfig re-merge), and how to extend/test.
---

# @codejoo/axp

Typed wrapper over `axios`: `create<T>(axiosInstance, opts?)` → `Core<T>`. Verb methods
(`get/post/...`) are built once on the prototype and dispatch through the plugin-wrapped
axios, resolving into one of three shapes. Plugins are single-purpose; ordering is the
caller's (no priority field).

## File map (src/)

| File | Role |
| --- | --- |
| `core.ts` | `Core<T>` + `create<T>()`. Builds verb methods once (`PROTO_BUILT` module flag). `dispatch` → `shapeResponse` resolves **raw / wrap / unwrap**. `extends()` clones axios defaults (structural shallow + targeted deep). |
| `plugin.ts` | `PluginManager`. Per-plugin `InternalRecord` tracks every interceptor/transform/adapter/cleanup so `eject` reverts all of it. `#refresh` = full teardown+reinstall on every `use`/`eject` (reverse-order teardown). Normalizes `defaults.adapter` to a function at construction. |
| `types.ts` | Plugin system types (`Plugin`, `PluginContext`, `PluginRecord`, `CoreOptions`) + the `HttpPrototype<T>` schema-inference machinery (consumes method-major `model.MethodRefs` via direct `T[Mt][P]` lookup; three dispatch overloads). |
| `helper.ts` | `__DEV__`, `NS`, loggers (`tagged`/NOOP/CONSOLE), `asArray`, type guards. |
| `bag.ts` | **B2** Symbol-keyed private bag (`setInternal/getInternal/delInternal`). Invisible to for-in/JSON/serialization. **Does NOT survive mergeConfig re-merge** — single-request scope only. |
| `objects/ApiResponse.ts` | `ApiResponse` (`successful` via static `isSuccessful` hook) + `fromResponse` (null-safe) + `ApiError extends Error`. |
| `objects/TokenManager.ts` | `TokenManager implements ITokenManager`; stores bare tokens, `accessToken` getter prepends `Bearer `; localStorage-backed, SSR-safe. |
| `plugins/*.ts` | One plugin each; each augments `axios` `AxiosRequestConfig` via `declare module 'axios'`. |

## Invariants & gotchas (learned the hard way — keep these)

- **axios `mergeConfig` only preserves enumerable string keys.** Empirically verified: `ctx.axios.request(config)` (retry/auth re-issue) re-merges and **drops Symbol keys, non-enumerable keys, and WeakMap<config> associations** (the merged config is a *new object*). Consequences:
  - **retry** counts attempts via an **enumerable** `config.__retryCount` (NOT WeakMap). The old WeakMap<config> approach caused **infinite retries on persistent failure** under real axios (count reset every re-merge) — only surfaced by integration tests, not unit tests (whose fake `ctx.axios.request` reuses the same config). Don't regress this.
  - **auth** state flags (`__auth_decision/protected/refreshed/denied`) are **enumerable string keys** for the same reason (refresh/replay must cross the re-issue boundary; `__auth_refreshed` breaks the refresh→retry→fail loop).
  - **cancel**'s AbortController lives in the **Symbol bag** (`bag.ts`) — it's "private + GC", needs no cross-re-merge survival. Pick the storage by whether state must survive re-issue, not by taste.
- **Response shape is decided by Core dispatch, not a plugin.** `shapeResponse` (core.ts): `{raw}`→envelope, `{wrap}`→`ApiResponse`, default→unwrap `{code,data}`'s `data` (non-envelope passes through).
- **auth refresh is "one budget per request", NOT "expired vs not".** Single-flight `refreshing`; new protected requests during the window suspend at the request interceptor; in-flight 401s join the same refresh on the response side. A 401 with `carried !== current` token → **Replay** (retry with current token, no refresh); `carried === current` → **Refresh once then replay**, and only if THAT still 401s → expire (bounded by the enumerable `__auth_refreshed` flag). Don't "fix" the carried===current case to expire-immediately by default — that would wrongly log out the recoverable case (token rotated by another tab/device, a fresh refresh still works). Strict "401-on-fresh-token = dead session" is a per-app policy expressed via a custom `onFailure` returning `AuthFailureAction.Expired` (see README). Proven bounded by `test/auth.integration.test.ts` (single-flight + at-most-one-refresh convergence).
- **`normalize-response` does NOT rewrite successful `response.data`** (keeps the raw envelope; dispatch owns shaping). On business failure it rejects an `ApiError`; on the error path it attaches `error.api`. **`auth` therefore uses `ApiResponse.fromResponse(res).successful`, never `instanceof ApiResponse`** (the old axios-plus contract). auth handles failure on **both** paths: envelope-fail in `onFulfilled`, HTTP 401/403 in `onRejected` (axp's normalize rejects them).
- **Adapter plugins (`cache/share/loading/mock`) `delete config.xxx` after resolving** ("解析即弃"). A retry full-chain re-issue therefore does **not** re-trigger them. To keep loading across retries, nest retry inside loading or use `share`'s retry policy.
- **`cache` stores the pristine original, hands out a copy per `clone`.** Default = **shared reference** (read-only contract, like SWR/React-Query). `clone:'shallow'` (top-level only), `'deep'` (`structuredClone`, throws if unavailable — pass a function for non-cloneable data). Never silently downgrade deep→shallow.
- **PluginManager auto-reverts everything registered via `ctx`** — plugin authors write no cleanup. Return a cleanup fn from `install` only for non-axios resources (timers/sockets). `#refresh` re-runs every `install`, so install-time effects must be idempotent (e.g. `envs`).
- **Ordering = `use()` order.** Request interceptors LIFO, response FIFO, transformers append-order, adapter last-wins. Documented, not enforced.
- **`fn.name` reassign needs `Object.defineProperty`** under strict-mode ESM (plain `fn.name =` throws). Used by `normalize-response`, `repath`, `auth` so `eject(factory)` works after minify.
- **`reqkey` tests are relational** (`a===b` / `a!==b`), never literal hashes — preserve invariants (key-order-independent objects, ordered arrays, empty-container equivalence, separator anti-collision), not specific digests. Double-lane FNV-1a → ~64-bit.
- **Schema is `model.MethodRefs` (method-major), consumed directly — no `_Indexed`.** `@codejoo/openapi2lang` emits TWO views: `model.PathRefs` (path-major, for openapi2lang's own `Request`/`OpenApi`) and `model.MethodRefs` (method-major `{ [method]: { [path]: [resp, req] } }`, **statically pre-expanded** by the emitter — `emitMethodRefs` in openapi's `typescript-emitter.ts`, NOT a TS-level `Invert<PathRefs>`). `Core<T>`'s `LoosePath`/`EntryFor` do `T[Mt][P]` literal lookups — O(1), no mapped/conditional fan-out. There used to be a `_Indexed<T>` type that inverted PathRefs at type-check time; it's gone — don't reintroduce it. Local route extension declaration-merges into `MethodRefs` (method-major nesting), not PathRefs. axp ships a hand-maintained fixture `types/paths.d.ts` containing both interfaces; regenerate via openapi's generate flow when the spec changes.

## Build & test (the real acceptance gate)

- **Gate = `npx vitest run` (all green; currently ~262) + `npm run build`** (`vp pack` → `dist/index.mjs`, `index.min.js`, `index.d.mts` via tsgo). Vitest include: `test/**/*.{test,spec}.ts`; helpers (e.g. `test/helpers/network.ts`) aren't picked up.
- **Do NOT gate on `tsgo`/`oxlint`** — they're dirty under the base `verbatimModuleSyntax`/`erasableSyntaxOnly` flags (param-properties, value-imports-of-types, test `as any`). Only avoid adding *new* error classes.
- **Integration tests are the high-value ones** (`test/integration.test.ts`, `test/auth.integration.test.ts`): they drive real `create()` + plugin stacks through `test/helpers/network.ts` (a stateful mock adapter with per-request `config.latency` for out-of-order completion, error injection, call counts). This is what caught the retry infinite-loop bug. Auth refresh/concurrency lives here — simulate expired tokens, single-flight, in-window arrivals, anti-loop.
- **e2e/** is a Playwright suite (real Chromium driving the `e2e/playground`). `npm run e2e` (full, run.mjs) or `npm run e2e:int` (focused integration cards only, integration.mjs — both self-spawn/reuse mock:4570 + playground:5180). Playground cards bake in a `pass` boolean; run.mjs/integration.mjs click each `testid` and assert it. Keep run.mjs's `cases` + integration.mjs's `cases` in sync with playground `testid`s when adding/renaming public API or integration cards. **Browser caveat**: ~6 concurrent connections per host, so strict single-flight (`refreshCalls===1`) isn't guaranteed in-browser for >6 concurrent — assert *bounded* there, exact single-flight in vitest. **Mock fallback**: the production `mock` plugin falls back client-side (axios re-dispatch on 404, covered by `test/integration.test.ts`); the **e2e demo** instead models server-side forwarding (mock-server `/gw/<path>` loopback-proxies to the real upstream, tags `_gw=1`) — closer to how real mock servers passthrough.

## Adding a plugin (pattern)

1. New `src/plugins/<name>.ts`: `export default function <name>(opts): Plugin` with `{ name, install(ctx) }`; gate on `enable` (`if (!enable) return`).
2. Register side-effects only through `ctx` (request/response/adapter/transformRequest/transformResponse/cleanup) so eject reverts them.
3. State: close over it in `install`. Per-request flags: Symbol bag (`bag.ts`) if single-request; **enumerable string key** if it must survive a retry/auth re-issue.
4. Augment request config via `declare module 'axios'`.
5. Export from `src/index.ts` (value + types). Add a unit suite in `test/` and, if it touches concurrency/adapters, an integration case. Document a section + option table in `README.md` (and `README.zh-CN.md`).
