# `plugin/` — Plugin lifecycle manager

`PluginManager` is the runtime that owns the install/eject lifecycle for every plugin attached to a `Core`. Its key contribution is **automatic side-effect tracking and reversal**: every interceptor / transformer / adapter swap that a plugin registers via `ctx` is recorded internally, and `eject()` (or implicit re-installs from `use()` / `eject()`) reverts each side effect deterministically.

## Files

| File | Role |
|---|---|
| [`plugin.ts`](./plugin.ts) | `PluginManager` class — install / eject / refresh, plus the `ctx` factory that proxies axios mutations through tracking. Plugin-manager-private logger machinery (`NS`, `NOOP_LOGGER`, `CONSOLE_LOGGER`, `tagged`) is colocated here |
| [`types.ts`](./types.ts) | Public types: `Plugin` / `PluginContext` / `PluginCleanup` / `PluginLogger` / `PluginRecord` / `IPluginCommonRequestOptions`. Internal `InternalRecord` shape (used only by the manager) is also defined here but not re-exported through `index.ts` |
| [`index.ts`](./index.ts) | Public barrel — `PluginManager` + the public types listed above |

## Plugin contract

```ts
interface Plugin {
  name: string;
  install(ctx: PluginContext): PluginCleanup | void;
}

interface PluginContext {
  axios: AxiosInstance;
  name: string;
  logger: PluginLogger;
  request(onF, onR?, options?): void;     // tracked
  response(onF, onR?): void;              // tracked
  adapter(adapter): void;                  // tracked + restored on eject
  transformRequest(...fns): void;          // tracked
  transformResponse(...fns): void;         // tracked
  cleanup(fn): void;                        // user-side teardown
}
```

A plugin author only writes the side-effect; the manager handles the bookkeeping. Returning a `PluginCleanup` from `install()` is for resources outside axios (timers, sockets, in-memory maps) that need to be torn down on eject.

## Lifecycle semantics

- **Install order matters.** axios's native interceptor model determines composition: request interceptors run LIFO (last `use`d runs first); response interceptors run FIFO (first `use`d runs first); transformers run in append order; adapter is "last `use`d wins". The manager doesn't add a priority field on top — the caller's `use()` order IS the priority.
- **`useMany` is atomic.** Batching multiple plugins into a single `use([a, b, c])` causes one `#refresh` cycle (O(N) installs) instead of N cycles (O(N²)). Failures during the batch leave previously-installed plugins untouched.
- **Duplicates are warned, not thrown.** A second `use(samePlugin)` emits `console.warn` (always, even when `debug: false`) and skips the duplicate install. To swap, `eject` first.
- **`eject` is reverse-order teardown.** The manager unwinds adapter swaps in reverse install order so each restore lands on the adapter the predecessor saved, matching the install stack.

## Why no priority field?

Priority systems make ordering decisions implicit and easy to break. With `use()`-order-as-contract, the install site shows you exactly what runs first. If you need a specific arrangement (e.g. install `key` before `share` so `config.key` exists when `share`'s adapter wrapper sees the request), the call site is the documentation.
