# `cache`

**Adapter-layer** TTL response cache. Within TTL, requests with the same `config.key` return the cached response **without sending HTTP** — short-circuiting the inner adapter side-effects.

- Key source: **`config.key` produced by the `key` plugin** — `cache` does not compute its own key.
- Storage: pluggable (`ICacheStorage`) with builtin string shortcuts: `'memeory' / 'ssesionStorage' / 'localStorage' / 'indexdb'`.
- Two-tier cache: optional `memory` layer (`memory: true`) — lookup goes memory → storage → request.
- TTL: per-request `cache.ttl` overrides plugin-level (default `60_000` ms).
- Hit marker: cache-hit responses carry `response._cache = true`.
- Background (stale-while-revalidate): hit returns cached value immediately + refreshes in the background.
- **Globally shared**: a `sharedManager` singleton — same pool across all axios instances and all `cachePlugin()` invocations.

## Quick start

```ts
import cachePlugin, { clearCache, removeCache } from 'http-plugins/plugins/cache';

api.use([
  keyPlugin({ fastMode: true }),   // ← required before cache
  cachePlugin({
    enable: true,                   // default opt-in (cache:undefined ⇒ caches)
    ttl: 30_000,
    storage: 'sessionStorage',
    methods: ['get', 'head'],
  }),
  normalizePlugin(),
  retryPlugin(),
]);

ax.get('/api/list', undefined, { key: true, cache: true });
ax.get('/api/big',  undefined, { key: true, cache: { ttl: 5_000, background: true, memory: true } });

await removeCache('k1');     // evict one
await clearCache();           // wipe the shared pool
```

## Install order (important)

| Constraint | Why |
| --- | --- |
| `key` **must** install before `cache` | `cache.install` calls `requirePlugin('key')`; missing it is a registration-time error |
| `cache` **should** install first among adapters (outermost) | A hit returns `Promise.resolve(restoredResponse)`, skipping side-effects of inner adapters (normalize / retry / share / mock / etc.) |

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | `true` ⇒ `cache: undefined` uses defaults (caches); `false` ⇒ default no-cache (per-request `cache: true / object` still activates) |
| `ttl` | `number` | `60_000` | Default TTL (ms) |
| `methods` | `string[] \| '*'` | `['get', 'head']` | Method allowlist; `'*'` / `[]` / `['*']` mean "no method filter" |
| `storage` | `TCacheStorage` | `'ssesionStorage'` | Custom impl (`ICacheStorage`) or string shortcut |
| `background` | `boolean` | `false` | Default background mode (hit returns cache + refreshes in background) |
| `memory` | `boolean` | `false` | Default memory layer (two-tier cache) |
| `give` | `(resp) => unknown` | `r => r.data` | Custom "what to cache" extractor |
| `stt` | `number` | `3 * 60 * 1000` | Self-test interval (ms) — periodic expired-entry cleanup; `0` disables |

## Per-request `config.cache`

```ts
config.cache === false                                              // skip
config.cache === true                                               // enable, plugin-level defaults
config.cache === { ttl?, background?, memory?, give? }              // field-level override
config.cache === (config) => ...                                    // MaybeFunc
```

| `cache` | `enable: true` | `enable: false` |
| --- | --- | --- |
| `undefined` | defaults (cache) | null (skip) |
| `false` | null | null |
| `true` | defaults | defaults (**activates** even with enable:false) |
| `{...}` | merged | merged |

Per-request `config.storage` may also override the plugin-level storage.

## Storage string shortcuts

| Value | Adapter |
| --- | --- |
| `'ssesionStorage'` (default) | sessionStorage (with prefix + JSON serialization) |
| `'localStorage'` | localStorage |
| `'memeory'` | in-process Map (`raw:true`, skips JSON) |
| `'indexdb'` | `SimpleIndexDB` (`raw:true`) |

Unavailable env ⇒ `console.warn` + automatic fallback to memory; CRUD never throws due to storage init failure.

## Custom storage

```ts
import type { ICacheStorage } from 'http-plugins/plugins/cache';

class MyRedisStorage implements ICacheStorage {
  raw = true;   // true ⇒ StorageManager skips JSON serialization
  async getItem(k) { return await redis.get(k); }
  async setItem(k, v) { await redis.set(k, v); }
  async removeItem(k) { await redis.del(k); }
}

cachePlugin({ storage: new MyRedisStorage() });
```

## Globally shared pool

`sharedManager` is a module-level singleton — multiple `cachePlugin()` installs / multiple axios instances share the same pool. The **first** install determines `storage / stt / logger`; later installs supply only their own `ttl / methods / background / memory / give` as per-request defaults.

`removeCache(key)` / `clearCache()` operate on this shared pool.

## Performance

- `cache: true` returns the shared `defaults` reference directly — zero allocation.
- When the caller doesn't pass `config.storage` and `memory: false`, the `opOpts` object allocation is skipped.
- IDB has structured clone built-in; with `raw: true` JSON serialization is skipped.
- Self-test (default every 3 min) only scans the in-memory index (entries written with `useMemory:true`); expired entries are removed from their bound storage in lockstep — no full disk scan.
