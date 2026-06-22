# @codejoo/storage

English | [简体中文](https://github.com/icodejoo/codejoo/tree/main/apps/storage/README.zh-CN.md)

A tiny, type-safe wrapper over `localStorage` / `sessionStorage` / `IndexedDB` with one unified API: TTL & absolute expiry, sliding renewal, namespaces, pluggable serialization (incl. `Date` / `Map` / `Set` / `bigint`), an optional obfuscation codec, an opt-in in-memory cache, and a key-bound shortcut helper. Sync backends return values; the async IndexedDB backend returns Promises — **decided by generics, one code path**.

- Zero deps · ESM · `sideEffects: false` · ships a per-module tree-shakeable build (`dist/esm/`).
- Falls back to in-memory storage automatically when the native API is unavailable (privacy mode, sandboxed iframe, etc.).

## Install

```sh
pnpm add @codejoo/storage
```

## Quick start

```ts
import { factory } from "@codejoo/storage";

const { ls, ss } = factory();

ls.set("token", "abc"); // localStorage
ls.get("token"); // "abc"
ls.get("missing", "default"); // "default"
ls.set("session", 1, 60_000); // expires in 60s (ttl ms)
ls.remove("token");
ls.clear();
ls.length; // number of entries
```

With IndexedDB (async, large quota). `Idb` is **not bundled by default** — import it yourself:

```ts
import { factory, Idb } from "@codejoo/storage";

const { db } = factory({ db: new Idb() });

await db.set("user", { id: 1 }); // Promise<void>
await db.get("user"); // Promise<{ id: 1 }>
```

## API

### `factory(options?)`

Returns `{ ls, ss, db, destroy, setNamespace }` over `localStorage`, `sessionStorage`, and the provided IndexedDB instance respectively. `ls`/`ss` are **synchronous**; `db` is **asynchronous** (returns Promises). All three share the same option behaviors. `destroy()` releases every layer at once (clears the memo caches and disconnects `db`'s IndexedDB connection) and returns a `Promise`; it does **not** delete persisted data. `setNamespace(username?)` switches the prefix of all three layers **in place** (great for per-account isolation on login/logout) — handles you already hold keep working; it only isolates, it does not erase the previous namespace's persisted data.

| Param     | Type                 | Required | Default | Description                                  |
| --------- | -------------------- | -------- | ------- | -------------------------------------------- |
| `options` | `BaseStorageOptions` | No       | `{}`    | Instance-level config applied to all layers. |

#### `BaseStorageOptions`

| Option        | Type                                                         | Required | Default          | Description                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------ | -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memoized`    | `boolean`                                                    | No       | `false`          | Enable in-memory read cache: writes mirror to cache, reads hit cache first, deletes are dual. Opt-in (not a full mirror), so memory grows only with use.                                                                                                                                       |
| `cloned`      | `boolean`                                                    | No       | `false`          | Return a deep copy (`structuredClone`) for objects shared with the memo cache, isolating caller mutations. Default shares references (zero cost).                                                                                                                                              |
| `serialize`   | `(entity: StorageEntity) => string`                          | No       | `JSON.stringify` | Custom entity → string serializer.                                                                                                                                                                                                                                                             |
| `deserialize` | `(raw: string) => StorageEntity`                             | No       | `JSON.parse`     | Custom string → entity deserializer (must pair with `serialize`).                                                                                                                                                                                                                              |
| `codeable`    | `boolean`                                                    | No       | `false`          | Whether to invoke `codec`. Lets you toggle encoding per environment (dev/prod).                                                                                                                                                                                                                |
| `codec`       | `Codec`                                                      | No       | —                | Encode/decode the serialized string (obfuscation / compression). Takes effect only when `codeable` is true.                                                                                                                                                                                    |
| `sliding`     | `boolean`                                                    | No       | `false`          | Sliding expiry: renew by original `ttl` on each read hit (good for sessions/auth). The write-back is skipped while >90% of the ttl remains, so hot reads don't amplify writes.                                                                                                                 |
| `namespace`   | `string`                                                     | No       | `""`             | Key prefix (`namespace:key`) to isolate apps/modules sharing the same origin.                                                                                                                                                                                                                  |
| `raw`         | `boolean`                                                    | No       | `false`          | Store the raw value directly, skipping the entity envelope (no ttl/codec). For interop with external data.                                                                                                                                                                                     |
| `force`       | `boolean`                                                    | No       | `true`           | On quota error, purge expired entries and retry the write; otherwise log & give up. **Sync backends only.**                                                                                                                                                                                    |
| `readonly`    | `boolean`                                                    | No       | `false`          | Write-once: only write when the key is empty (absent/expired); otherwise discard the write.                                                                                                                                                                                                    |
| `enckey`      | `boolean`                                                    | No       | `false`          | Also obfuscate the **key**: when set with a `codec`, the storage key is deterministically run through the codec (hides plaintext key names). This only obfuscates key names via the codec — **not a security measure** — and requires a `codec`, else it warns and degrades to plaintext keys. |
| `onError`     | `(info: { op: "set"; key: string; error: unknown }) => void` | No       | —                | Write-failure callback (quota exceeded, `force` retry still failing). When provided it replaces the default `console.error`, so the caller can observe failures (`set` returns `void`, so failures are otherwise invisible). Called once per failing key in a batch `set`.                     |
| `db`          | `AsyncStorage`                                               | No       | —                | An IndexedDB instance (e.g. `new Idb()`) exposed as `factory().db`. Using `db` without it throws a helpful error.                                                                                                                                                                              |

### Handler methods (`ls` / `ss` / `db`)

`R<T>` is `T` for sync backends (`ls`/`ss`) and `Promise<T>` for the async backend (`db`).

| Method                        | Returns           | Description                                                                                                                                                                                             |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get<T>(key)`                 | `R<T \| null>`    | Read; missing → `null`.                                                                                                                                                                                 |
| `get(key, defaultValue)`      | `R<T>`            | Read; missing/expired/undecodable → `defaultValue`.                                                                                                                                                     |
| `set(key, value, ttl?)`       | `R<void>`         | Write; `ttl` in ms. Invalid `ttl` (`0` / negative / `NaN` / `Infinity`) is warned and ignored — the value is still persisted (never written-then-immediately-deleted nor made never-expiring).          |
| `set(key, value, options?)`   | `R<void>`         | Write; `StorageOptions` (ttl / expireAt / memoized). Opt-in memo is now only via the object form (`set(k, v, { memoized: true })`).                                                                     |
| `remove(key)`                 | `R<void>`         | Delete (cache + backend).                                                                                                                                                                               |
| `get(keys, defaults?)`        | `R<tuple>`        | **Batch read**: pass an array of keys; returns a same-length tuple. `defaults` map positionally and drive per-slot types (`get(["a","b"],[1,false])` → `[number, boolean]`; `as const` keeps literals). |
| `set(keys, values, options?)` | `R<void>`         | **Batch write**: positional pairs; the 3rd arg applies to every key. If `values` is shorter, missing slots are skipped (warned).                                                                        |
| `remove(keys)`                | `R<void>`         | **Batch delete.** Batch `get`/`set`/`remove` are implemented by iterating the key array and reusing the single-key logic per key (on the async backend, one transaction per key).                       |
| `keys()`                      | `R<string[]>`     | All logical keys owned by this instance (decrypted, namespace-stripped).                                                                                                                                |
| `purge()`                     | `R<void>`         | Proactively delete expired entries (owned, written by this lib). Expiry is otherwise lazy — entries never read again stay until `purge()`/quota pressure.                                               |
| `clear()`                     | `R<void>`         | With `namespace` or `enckey`: removes only this instance's keys (other namespaces / foreign data untouched). Otherwise clears the whole backend.                                                        |
| `destroy()`                   | `R<void>`         | Release resources: clear the memo cache and disconnect a closeable backend (IndexedDB). **Keeps persisted data.**                                                                                       |
| `key(index)`                  | `R<string\|null>` | The `index`-th logical key (decrypted, namespace-stripped).                                                                                                                                             |
| `length`                      | `R<number>`       | Entry count (getter). With `namespace` or `enckey` it counts only the keys this instance owns (consistent with `keys()`/`clear()`); otherwise it returns the backend's global entry count.              |
| `namespace`                   | `string`          | The namespace prefix (e.g. `"ns:"`, or `""`).                                                                                                                                                           |
| `setNamespace(ns?)`           | `void`            | Switch the prefix in place (e.g. per username); clears the memo cache. Held handles keep working.                                                                                                       |

#### `StorageOptions` (per-call `set` options)

Only these three apply per call (everything else — codec, sliding, raw… — is instance-level, see `BaseStorageOptions`):

| Option     | Type                       | Required | Default | Description                                                                                                                                                                     |
| ---------- | -------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ttl`      | `number`                   | No       | —       | Time-to-live in ms (relative). Sets `expireAt = now + ttl`. An invalid value (`0` / negative / `NaN` / `Infinity`) is warned and ignored, so the value persists with no expiry. |
| `expireAt` | `number \| string \| Date` | No       | —       | Absolute expiry (timestamp / date string / `Date`). If in the past (and not renewable via `sliding` + `ttl`), the write is skipped with a warning.                              |
| `memoized` | `boolean`                  | No       | —       | Mirror this write into the memo read cache (overrides the instance-level `memoized`).                                                                                           |

### `fast(target, key)`

Binds a handler and a key, returning `{ get, set, remove }` so you stop repeating the key. Sync/async return type follows `target`. Specify the value type once via `fast<V>(...)`.

| Param    | Type                       | Required | Default | Description                 |
| -------- | -------------------------- | -------- | ------- | --------------------------- |
| `target` | `ls` / `ss` / `db` handler | Yes      | —       | A handler from `factory()`. |
| `key`    | `string`                   | Yes      | —       | The key to bind.            |

```ts
const token = fast<string>(ls, "token");
token.set("abc"); // value must be string
token.get(); // string | null
token.get("def"); // string
token.remove();
```

Accessor shape — `SyncAccessor<V>` (sync) / `AsyncAccessor<V>` (async):

| Method                 | Returns        | Description                           |
| ---------------------- | -------------- | ------------------------------------- |
| `get()`                | `R<V \| null>` | Read.                                 |
| `get(defaultValue)`    | `R<V>`         | Read with default.                    |
| `set(value, options?)` | `R<void>`      | Write; `options` = ttl/memoized/opts. |
| `remove()`             | `R<void>`      | Delete.                               |

### `lazy(target, key)`

Like `fast`, but returns a **getter** that builds the accessor on first call and caches it. Combined with a `/*#__PURE__*/` annotation, unused exports are tree-shaken — ideal for a central `cache.ts` registry of many keys.

```ts
export const token = /*#__PURE__*/ lazy<string>(ls, "token");
token().get(); // accessor created on first use, reused after
```

### `batchFast(target, keys)`

Bind several keys at once; returns an object keyed by each key, with a fast accessor per key (key names preserved via `const` generic; value type `V` shared, defaults to `unknown`).

```ts
const { token, user } = batchFast(ls, ["token", "user"]);
token.set("abc");
user.get();
```

### `JSONX`

`JSON`-compatible serializer that additionally round-trips `bigint` / `Date` / `Map` / `Set`. Methods don't use `this`, so they can be passed directly as `serialize`/`deserialize`.

| Method                           | Returns  | Description                        |
| -------------------------------- | -------- | ---------------------------------- |
| `JSONX.stringify(value, space?)` | `string` | Serialize, preserving rich types.  |
| `JSONX.parse(text)`              | `any`    | Deserialize, restoring rich types. |

```ts
const { ls } = factory({ serialize: JSONX.stringify, deserialize: JSONX.parse });
ls.set("x", { when: new Date(), ids: new Set([1n, 2n]) }); // round-trips exactly
```

> Circular references are not supported (inherits `JSON.stringify` behavior — throws).

### Codecs — `codec` / `codecBase64` / `codecAtob`

Three lightweight **obfuscation** codecs (keep plaintext out of devtools — **not strong encryption**, the password ships in the bundle). All take an optional `password` (built-in default otherwise); changing it makes old data undecodable — `decode` returns `null` and the stale entry is cleared on read. Use with `{ codeable: true, codec: codec("pw") }`.

| Export                       | Scheme                                                                                                                        | Pick it for                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `codec(password?)` (default) | Branch-free 10-bit XOR over UTF-16 code units; output = input + 1 unit                                                        | Best size (zero inflation — CJK stores at 1/3 the quota of base64), lowest latency, no runtime requirement |
| `codecBase64(password?)`     | Native `Uint8Array.toBase64` (base64url, no padding, rotated), auto-falls back to `atob`/`btoa` on old runtimes (same format) | Highest throughput on large ASCII payloads (native SIMD); +33% size (CJK 3×)                               |
| `codecAtob(password?)`       | Always `TextEncoder` + `atob`/`btoa`                                                                                          | Identical behavior everywhere (no feature detection); same format as `codecBase64`, mutually decodable     |

`Codec` shape:

| Method          | Returns          | Description                                                      |
| --------------- | ---------------- | ---------------------------------------------------------------- |
| `encode(value)` | `string`         | Obfuscate a string.                                              |
| `decode(value)` | `string \| null` | Reverse; returns `null` on key mismatch / corruption (no throw). |

### `Idb(name?)`

An **asynchronous** `Storage`-like backend over IndexedDB. No full in-memory mirror (constant memory; data is GC-friendly). Pass it to `factory({ db })`. Falls back to in-memory automatically if IndexedDB is unavailable or `open()` fails at runtime.

| Param  | Type     | Required | Default              | Description              |
| ------ | -------- | -------- | -------------------- | ------------------------ |
| `name` | `string` | No       | `"@codejoo/storage"` | IndexedDB database name. |

Methods (all return Promises): `get(key)`, `set(key, value)`, `remove(key)`, `clear()`, `key(index)`, `keys()`, `length()`, `destroy()` (close the connection; keeps data). Handler-level batch ops loop over these single-key methods (one transaction per key) — there is no bulk `getMany`/`setMany`/`removeMany` primitive.

### `crossTab(handler, channel?)`

Standalone plugin (tree-shakes away when unused). Only activates in **pure in-memory mode** (native storage unavailable — privacy mode, sandboxed iframe): replays `set`/`remove`/`clear` to other same-origin tabs via `BroadcastChannel` so each tab's memory stays consistent. No-op when native storage works (already shared) or when mounted twice. Local writes apply **before** broadcasting; a failed broadcast (non-cloneable value) only warns. `setNamespace` is not synchronized — switch it per tab. Returns a stop function.

```ts
import { factory, crossTab } from "@codejoo/storage";
const { ls } = factory();
const stop = crossTab(ls);
```

### `debug(handler)`

Standalone helper shipped as a **separate subpath** (`@codejoo/storage/debug`) — it is not part of the main entry, so the single-file bundles (`dist/index.mjs` / `index.min.js`) physically exclude it. Reads every entry of a handler **decrypted** and returns a `{ "namespace:key": value }` snapshot (namespace **preserved**). It is a **pure read with no side effects** — it does not write the snapshot back to storage, so it never pollutes `keys()`/`length`. Use it to inspect data written with `codeable`/`enckey`.

```ts
import { factory, codec } from "@codejoo/storage";
import { debug } from "@codejoo/storage/debug";

const { ls, db } = factory({ codeable: true, codec: codec("pw"), enckey: true });
debug(ls); // sync → { "key": value, ... }
await debug(db); // async backend → Promise
```

## Notes

- **Sync vs async** is driven by the backend type via generics: `ls.get(k)` returns a value, `db.get(k)` returns a `Promise`. One proxy implementation serves both.
- **`db` features**: `ttl` / `expireAt` / `codec` / `namespace` / `sliding` / `memoized` all apply to `db` too (just `await` it). `force` quota-purge currently applies to sync backends only.
- **Memo is isolated per `factory()` instance**: each `factory()` call gets its own in-memory read cache; separate instances do not share memo (no cross-instance reads).
- **Tree-shaking**: the package points `import` at `dist/esm/` (one file per module). With `sideEffects: false`, unused modules/exports are dropped by the bundler.

## Differences from native localStorage

- **Values are wrapped in an entity envelope** (`{ value, createdAt, ... }`) by default, not stored as bare strings. Reading a key with the native `localStorage.getItem` (bypassing this library) yields the JSON envelope, not your raw value (except in `raw` mode).
- **`set` does not throw on quota** (native throws `QuotaExceededError`). When storage is full it only logs / invokes `onError` and gives up the write — use `onError` if you need to observe write failures.
- **`length` and `clear()` are namespace-scoped**: with `namespace`/`enckey` they cover only the keys this instance owns, unlike native's global semantics.
- **Expiry is lazy**: expired entries are not read and not eagerly deleted; they are reclaimed by `purge()` or under quota pressure.

## Build outputs

| Path                | Format                 | Purpose                           |
| ------------------- | ---------------------- | --------------------------------- |
| `dist/esm/*.mjs`    | Per-module ESM         | Default `import`, tree-shakeable. |
| `dist/index.mjs`    | Single-file ESM bundle | Whole-library import.             |
| `dist/index.min.js` | Minified ESM           | `./min` subpath.                  |

## Testing

```sh
pnpm test
```

runs the full integration suite (`test/*.browser.test.ts`) in a **real Chromium** via Playwright (vitest browser mode), against real `localStorage` / `sessionStorage` / `IndexedDB` / `BroadcastChannel` — not a jsdom simulation. This covers sync backends, async IDB transactions, and cross-tab sync as they behave in an actual browser.

An interactive playground remains at [`test/manual.html`](./test/manual.html): run `pnpm dev` and open `/test/manual.html`.

## License

MIT
