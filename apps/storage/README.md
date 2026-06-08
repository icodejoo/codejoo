# @codejoo/storage

English | [简体中文](./README.zh-CN.md)

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

ls.set("token", "abc");           // localStorage
ls.get("token");                  // "abc"
ls.get("missing", "default");     // "default"
ls.set("session", 1, 60_000);     // expires in 60s (ttl ms)
ls.remove("token");
ls.clear();
ls.length;                        // number of entries
```

With IndexedDB (async, large quota). `IdbStorage` is **not bundled by default** — import it yourself:

```ts
import { factory, IdbStorage } from "@codejoo/storage";

const { db } = factory({ db: new IdbStorage() });

await db.set("user", { id: 1 });  // Promise<void>
await db.get("user");             // Promise<{ id: 1 }>
```

## API

### `factory(options?)`

Returns `{ ls, ss, db, destroy, setNamespace }` over `localStorage`, `sessionStorage`, and the provided IndexedDB instance respectively. `ls`/`ss` are **synchronous**; `db` is **asynchronous** (returns Promises). All three share the same option behaviors. `destroy()` releases every layer at once (clears the memo caches and disconnects `db`'s IndexedDB connection) and returns a `Promise`; it does **not** delete persisted data. `setNamespace(username?)` switches the prefix of all three layers **in place** (great for per-account isolation on login/logout) — handles you already hold keep working; it only isolates, it does not erase the previous namespace's persisted data.

| Param     | Type                 | Required | Default | Description                                  |
| --------- | -------------------- | -------- | ------- | -------------------------------------------- |
| `options` | `BaseStorageOptions` | No       | `{}`    | Instance-level config applied to all layers. |

#### `BaseStorageOptions`

| Option        | Type                                | Required | Default          | Description                                                                                                  |
| ------------- | ----------------------------------- | -------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `memoized`    | `boolean`                           | No       | `false`          | Enable in-memory read cache: writes mirror to cache, reads hit cache first, deletes are dual. Opt-in (not a full mirror), so memory grows only with use. |
| `serialize`   | `(entity: StorageEntity) => string` | No       | `JSON.stringify` | Custom entity → string serializer.                                                                           |
| `deserialize` | `(raw: string) => StorageEntity`    | No       | `JSON.parse`     | Custom string → entity deserializer (must pair with `serialize`).                                            |
| `codeable`    | `boolean`                           | No       | `false`          | Whether to invoke `codec`. Lets you toggle encoding per environment (dev/prod).                              |
| `codec`       | `Codec`                             | No       | —                | Encode/decode the serialized string (obfuscation / compression). Takes effect only when `codeable` is true. |
| `sliding`     | `boolean`                           | No       | `false`          | Sliding expiry: renew by original `ttl` on each read hit (good for sessions/auth).                           |
| `namespace`   | `string`                            | No       | `""`             | Key prefix (`namespace:key`) to isolate apps/modules sharing the same origin.                                |
| `raw`         | `boolean`                           | No       | `false`          | Store the raw value directly, skipping the entity envelope (no ttl/codec). For interop with external data.   |
| `force`       | `boolean`                           | No       | `true`           | On quota error, purge expired entries and retry the write; otherwise log & give up. **Sync backends only.**  |
| `readonly`    | `boolean`                           | No       | `false`          | Write-once: only write when the key is empty (absent/expired); otherwise discard the write.                  |
| `enckey`      | `boolean`                           | No       | `false`          | Also encrypt the **key**: when set with a `codec`, the storage key is deterministically encrypted (hides plaintext key names). |
| `db`          | `AsyncStorage`                      | No       | —                | An IndexedDB instance (e.g. `new IdbStorage()`) exposed as `factory().db`. Using `db` without it throws a helpful error. |

### Handler methods (`ls` / `ss` / `db`)

`R<T>` is `T` for sync backends (`ls`/`ss`) and `Promise<T>` for the async backend (`db`).

| Method                       | Returns        | Description                                         |
| ---------------------------- | -------------- | --------------------------------------------------- |
| `get<T>(key)`                | `R<T \| null>`   | Read; missing → `null`.                             |
| `get(key, defaultValue)`     | `R<T>`           | Read; missing/expired/undecodable → `defaultValue`. |
| `set(key, value, ttl?)`      | `R<void>`        | Write; `ttl` in ms.                                 |
| `set(key, value, memoized?)` | `R<void>`        | Write; `boolean` toggles per-call memo mirroring.   |
| `set(key, value, options?)`  | `R<void>`        | Write; `StorageOptions` (ttl / expireAt / memoized).|
| `remove(key)`                | `R<void>`        | Delete (cache + backend).                           |
| `clear()`                    | `R<void>`        | Clear everything.                                   |
| `destroy()`                  | `R<void>`        | Release resources: clear the memo cache and disconnect a closeable backend (IndexedDB). **Keeps persisted data.** |
| `key(index)`                 | `R<string\|null>`| The `index`-th logical key (decrypted, namespace-stripped). |
| `length`                     | `R<number>`      | Entry count (getter).                               |
| `namespace`                  | `string`         | The namespace prefix (e.g. `"ns:"`, or `""`).       |
| `setNamespace(ns?)`          | `void`           | Switch the prefix in place (e.g. per username); clears the memo cache. Held handles keep working. |

#### `StorageOptions` (per-call `set` options)

Extends `BaseStorageOptions` (except `db`) and adds:

| Option     | Type                       | Required | Default | Description                                                                                                                |
| ---------- | -------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ttl`      | `number`                   | No       | —       | Time-to-live in ms (relative). Sets `expireAt = now + ttl`.                                                                |
| `expireAt` | `number \| string \| Date` | No       | —       | Absolute expiry (timestamp / date string / `Date`). If in the past and not `sliding`, the write is skipped with a warning. |

### `fast(target, key)`

Binds a handler and a key, returning `{ get, set, remove }` so you stop repeating the key. Sync/async return type follows `target`. Specify the value type once via `fast<V>(...)`.

| Param    | Type                       | Required | Default | Description                      |
| -------- | -------------------------- | -------- | ------- | -------------------------------- |
| `target` | `ls` / `ss` / `db` handler | Yes      | —       | A handler from `factory()`. |
| `key`    | `string`                   | Yes      | —       | The key to bind.                 |

```ts
const token = fast<string>(ls, "token");
token.set("abc");      // value must be string
token.get();           // string | null
token.get("def");      // string
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
token().get();   // accessor created on first use, reused after
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

| Method                           | Returns  | Description                          |
| -------------------------------- | -------- | ------------------------------------ |
| `JSONX.stringify(value, space?)` | `string` | Serialize, preserving rich types.    |
| `JSONX.parse(text)`              | `any`    | Deserialize, restoring rich types.   |

```ts
const { ls } = factory({ serialize: JSONX.stringify, deserialize: JSONX.parse });
ls.set("x", { when: new Date(), ids: new Set([1n, 2n]) }); // round-trips exactly
```

> Circular references are not supported (inherits `JSON.stringify` behavior — throws).

### `buildCodec(password?)`

Builds a lightweight **obfuscation** codec (repeating-key XOR + custom-alphabet base64). Intended to keep plaintext out of devtools — **not strong encryption** (the key ships in the bundle). Use with `{ codeable: true, codec }`.

| Param      | Type     | Required | Default      | Description                                                                                                                        |
| ---------- | -------- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `password` | `string` | No       | built-in key | XOR key. Changing it makes old data undecodable (no migration); `decode` then returns `null`, and the stale entry is cleared on read. |

`Codec` shape:

| Method          | Returns          | Description                                                       |
| --------------- | ---------------- | ----------------------------------------------------------------- |
| `encode(value)` | `string`         | Obfuscate a string.                                               |
| `decode(value)` | `string \| null` | Reverse; returns `null` on key mismatch / corruption (no throw).  |

### `IdbStorage(name?)`

An **asynchronous** `Storage`-like backend over IndexedDB. No full in-memory mirror (constant memory; data is GC-friendly). Pass it to `factory({ db })`. Falls back to in-memory automatically if IndexedDB is unavailable or `open()` fails at runtime.

| Param  | Type     | Required | Default              | Description              |
| ------ | -------- | -------- | -------------------- | ------------------------ |
| `name` | `string` | No       | `"@codejoo/storage"` | IndexedDB database name. |

Methods (all return Promises): `get(key)`, `set(key, value)`, `remove(key)`, `clear()`, `key(index)`, `length()`, `destroy()` (close the connection; keeps data).

### `debug(handler)`

Standalone helper (import it explicitly — not part of the core proxy, so it tree-shakes away when unused). Reads every entry of a handler **decrypted**, returns a `{ "namespace:key": value }` snapshot (namespace **preserved**), and stashes it under `"_$debug"`. Use it to inspect data written with `codeable`/`enckey`.

```ts
import { factory, buildCodec, debug } from "@codejoo/storage";

const { ls, db } = factory({ codeable: true, codec: buildCodec("pw"), enckey: true });
debug(ls);        // sync → { "key": value, ... }
await debug(db);  // async backend → Promise
```

## Notes

- **Sync vs async** is driven by the backend type via generics: `ls.get(k)` returns a value, `db.get(k)` returns a `Promise`. One proxy implementation serves both.
- **`db` features**: `ttl` / `expireAt` / `codec` / `namespace` / `sliding` / `memoized` all apply to `db` too (just `await` it). `force` quota-purge currently applies to sync backends only.
- **Tree-shaking**: the package points `import` at `dist/esm/` (one file per module). With `sideEffects: false`, unused modules/exports are dropped by the bundler.

## Build outputs

| Path                | Format                 | Purpose                           |
| ------------------- | ---------------------- | --------------------------------- |
| `dist/esm/*.mjs`    | Per-module ESM         | Default `import`, tree-shakeable. |
| `dist/index.mjs`    | Single-file ESM bundle | Whole-library import.             |
| `dist/index.min.js` | Minified ESM           | `./min` subpath.                  |

## Testing

A standalone browser test page lives in [`test/`](./test/). Run the dev server and open it:

```sh
pnpm dev          # then open the printed URL + /test/
```

It loads the source directly (Vite transforms TS) and renders pass/fail for every API.

## License

MIT
