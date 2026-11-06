# @codejoo/storage

[简体中文](./README.zh-CN.md) · [Architecture](./ARCHITECTURE.md)

A typed ESM wrapper for localStorage, sessionStorage and explicitly configured IndexedDB. One handler API provides TTL, sliding expiry, namespaces, optional memo caching and pluggable serialization. Syntax target: es2022.

## Quick start

```sh
pnpm add @codejoo/storage
```

```ts
import { factory, Idb } from "@codejoo/storage";

const storage = factory({ namespace: "app", db: new Idb("app-cache") });
const { ls, ss, db } = storage;
ls.set("count", 1, 60_000);
ls.get("count", 0); // number, synchronous
ss.set("draft", "hello");
await db.set("profile", { name: "Ada" }, { ttl: 60_000 });
await db.get("profile");
storage.setNamespace("u42"); // switches all three handlers; keeps old data
await storage.destroy(); // releases memo/connections; keeps backend data
```

`ls` and `ss` are synchronous. `db` returns Promises and requires an explicitly supplied `AsyncStorage`, usually `new Idb()`. Calling an unconfigured db fails. Native-unavailable ls and ss use separate module-level shared memory backends; Idb fallback is shared by database/store name. Sharing applies within the same module instance/realm. Each factory still has independent memo caches, strictly separate from fallback data. `destroy()` does not erase fallback data.

## Handler API

| Member | Contract |
| --- | --- |
| `get(key, defaultValue?)` | Missing/expired/corrupt entries return the default; omitted or undefined defaults become null. |
| `get(keys, defaults?)` | Tuple-based batch read, defaults apply position by position. |
| `set(key, value, ttlOrOptions?)` | Third argument: TTL milliseconds or `StorageOptions`. |
| `set(keys, values, ttlOrOptions?)` | Per-key writes; missing values are skipped with a warning. |
| `remove(keyOrKeys)` | Deletes one key or an array of keys. |
| `keys()` / `length` | Owned logical keys / count. Async length is a Promise property on the handler. |
| `key(index)` | Deprecated; prefer `keys()`. |
| `clear()` | Removes only keys owned by this namespace/key codec. |
| `purge()` | Removes valid expired entities in scope; raw mode does nothing. |
| `namespace` | Escaped namespace prefix, including trailing colon, or empty string. |
| `setNamespace(namespace?)` | Switches scope and invalidates memo; leaves previous scope's data intact. |
| `destroy()` | Invalidates memo and releases resources; does not delete backend data. |

```ts
ls.set(["count", "ready"], [1, true], { ttl: 5_000 });
const pair = ls.get(["count", "ready"], [0, false]); // [number, boolean]
const asserted = ls.get<[number, boolean]>(["count", "ready"]); // nullable elements
ls.remove(["count", "ready"]);
```

Defaults that are primitives or arrays enable a lightweight runtime type check: `ls.set("n", "text"); ls.get("n", 0)` returns 0 and reports `kind:"type"`, preserving the stored string. Ordinary object defaults do not validate fields; generics are not runtime schemas. With an undefined default the return type includes null (`V | null`), including fast accessors. A stored null with a primitive default (e.g. `ls.set("empty", null); ls.get("empty", 0)`) silently returns 0 without a type report and keeps the stored null. No default or an ordinary object default still returns null; an array default reports a type mismatch. A stored null is a present entry for readonly.

## Options

`BaseStorageOptions` are shared by all three handlers created by a factory.

| Option | Default / behavior |
| --- | --- |
| `namespace` | No prefix; `%` and `:` in the namespace are escaped. |
| `memoized` | false; cache decoded entities/raw strings after successful reads/writes. |
| `cloned` | false; structuredClone object values in normal mode, including non-memo reads, to isolate mutations; uncloneable values may throw. |
| `sliding` | false; renew TTL on eligible reads. Requires createdAt, ttl and expireAt; renew when remaining lifetime is <=90% of ttl. |
| `serialize` / `deserialize` | JSON.stringify / JSON.parse; operate on the entire entity. |
| `codeable` / `codec` | false / none; enables value encoding with the supplied Codec. |
| `enckey` | false; encode namespace + logical key when a codec is supplied, independently of codeable. |
| `raw` | false; true stores strings without entity serialization/value encoding/TTL; non-string writes warn and skip. |
| `force` | true; synchronous set failure (including readonly) purges expired entries and retries once. false skips cleanup/retry; backend write failure reports through onError or console.error without throwing. |
| `readonly` | false; write only when absent/expired/invalid. A valid stored null counts as present. |
| `broadcast` | false; opt-in IndexedDB cross-tab memo invalidation via BroadcastChannel. |
| `onError` | Structured error callback; see below. |
| `db` | Explicit async backend, e.g. new Idb(); no implicit IndexedDB construction. |

Per-call `StorageOptions`: `ttl?: number`, `expireAt?: number | string | Date`, `memoized?: boolean`. Other options are instance-level. Invalid nonpositive/nonfinite TTL warns and is ignored. An explicit expireAt takes precedence; invalid/past dates skip the write, except sliding + valid ttl can replace a past date with now + ttl.

The default envelope is `{ value, createdAt, expireAt?, ttl? }`. A valid envelope has its own value property and finite numeric metadata when present; legacy `ttl:null` / `expireAt:null` are treated as absent, while `createdAt:null` is corrupt. Expiry requires createdAt and expireAt, and occurs at now >= expireAt. `set(k, undefined)` with default JSON omits value, so a later read reports corruption, returns the default and attempts deletion. Prefer `remove(k)` to delete and null for an intentional stored empty value.

## Errors and 0.2.0 migration

`StorageErrorInfo` is a discriminated union with `kind`, `op`, logical `key`, and original `error`. `StorageOperation` is `"get" | "set" | "remove" | "clear" | "purge"`; scope-wide operations can use an empty key.

| kind | Meaning |
| --- | --- |
| `write` | A wrapped backend mutation failed. |
| `serialize` | Entity serialization or value encoding failed. |
| `corrupt` | Value decoding, parsing or envelope validation failed. Reported before conditional removal. |
| `type` | Stored value differs from a checkable default; data is kept. |
| `abort` | A wrapped transaction error has name AbortError. |

Migration from the old callback shape: add a kind branch and handle the expanded op union; keep using error for the original exception.

```ts
import { factory, type StorageErrorInfo } from "@codejoo/storage";

const onError = (info: StorageErrorInfo): void => {
  if (info.kind === "type") {
    console.warn(info.key, info.error);
    return;
  }
  console.error(info.kind, info.op, info.key, info.error);
};
const { ls } = factory({ force: false, onError });
ls.set("count", 1); // observe failures in onError instead of try/catch
```

Without a callback, wrapped read/mutation reports use console.error. Serialization exceptions still throw for sync handlers and reject for async handlers when no callback is supplied. Callback exceptions propagate unchanged. Backend reads/enumeration are not all converted to error callbacks. `force:false` controls cleanup/retry, not error propagation from callbacks or serializers.

Migration of type checks: choose a default matching the stored type, or read without a default and validate the result yourself. Migration of readonly/null: explicitly remove an existing key before replacing null. Migration of undefined values: use null for a persistent empty value or remove the key.

## Namespaces and existing data

Escape namespace `%` → `%25`, then `:` → `%3A`, then append `:`. Logical keys are not escaped. `namespace:"a:b%"` uses prefix `a%3Ab%25:`. Namespaces without these two characters keep their old physical keys. Old colon-containing namespaces such as `"user:42"` cannot read their old data after upgrading. There is no automatic migration; migrate manually as below.

For old localStorage keys with a special namespace, stop other writers and explicitly enumerate the logical keys to migrate. This example is **only for non-enckey storage**; it copies the stored envelope unchanged and preserves absolute expiry. Verify destination data before removing old keys. Do not migrate by a broad prefix scan: old namespace prefixes can overlap.

```ts
const oldNamespace = "user:42%";
const oldPrefix = oldNamespace + ":";
const newPrefix = oldNamespace.replaceAll("%", "%25").replaceAll(":", "%3A") + ":";
const logicalKeys = ["token", "profile"]; // explicit application-owned allowlist
for (const key of logicalKeys) {
  const from = oldPrefix + key;
  const to = newPrefix + key;
  const payload = localStorage.getItem(from);
  if (payload !== null && localStorage.getItem(to) === null) {
    localStorage.setItem(to, payload);
    if (localStorage.getItem(to) === payload) localStorage.removeItem(from);
  }
}
```

For encoded keys, use the same codec to encode each complete old/new key; for IndexedDB, read/write the physical strings through the configured backend and await each operation. A changed codec or custom format requires its own migration. Reload/recreate memoized handlers after external migration writes.

## Memo and backend consistency

Memo is opt-in, per handler, and not a full backend mirror. Successful processor writes notify other handlers sharing the same backend area; caching handlers lazily register. Native storage events invalidate affected memo entries (clear invalidates all). localStorage can notify other tabs; sessionStorage notifications retain browser session isolation. Direct native writes in the same tab do not generate that tab's storage event and can leave memo stale.

For Idb cross-tab invalidation, opt in on participating factories:

```ts
const { db } = factory({
  db: new Idb("shared-cache"),
  memoized: true,
  broadcast: true,
});
```

The broadcast sends invalidations, not values, and requires BroadcastChannel plus matching database-name channels. Within one module/realm, Idb instances share area by database name; same-name instances automatically invalidate each other's same-tab memo without broadcast, while managing separate connections. Custom backends may provide a stable `area?: object` for a shared storage domain; optional readonly `kind?: "local" | "session" | "idb"` describes backend category. Notifications do not guarantee freshness after missed messages or out-of-band writes.

Every operation captures its namespace/keyspace at start. Per-key versions and a global generation prevent stale memo refill or stale read-side renewal/deletion after intervening operations in the handler. Already-issued backend requests cannot be cancelled; cross-instance conditional writes require update support.

`setNamespace()` and `destroy()` preserve initiated async writes in their starting namespace. Async destroy waits for pending work before closing the backend. With no clear barrier or readonly queue, each async set dispatches immediately in invocation order and clears stale memo at entry; `set(k,v); get(k)` and `set(k,v); keys()` observe the queued write on FIFO backends such as IDB.

`clear()` removes the owned scope. With no namespace or effective key codec it calls backend clear directly, and length/key query the backend directly, consistent with 0.1.x. Otherwise it enumerates and deletes every owned key without a scope-wide transaction, reusing queued writes’ tokens. Later get/set/keys/length/key/purge on the same handler wait for the clear barrier; queued writes then run in order. A clear failure does not reject these later operations. Clear emits COMMIT only when every deletion succeeds; Hub caches are invalidated even after failure. These guarantees are not cross-instance locks.

Wrapped backend failures in handler remove/clear report through onError / console.error instead of rejecting/throwing that backend error; enumeration and callback exceptions may still propagate. A resolved operation does not prove every deletion succeeded. Direct Idb backend methods retain their reject-on-failure contract.

## Shortcuts and serialization

```ts
import { factory, fast, lazy, batchFast, JSONX } from "@codejoo/storage";

const { ls } = factory({ serialize: JSONX.stringify, deserialize: JSONX.parse });
const count = fast<number>(ls, "count");
count.set(1);
count.get(undefined); // number | null
const token = /*#__PURE__*/ lazy<string>(ls, "token");
token().get(); // accessor created on first call
const inferred = batchFast(ls, ["token", "user"]); // value type unknown
const keys = ["a", "b"] as const;
const typed = batchFast<number, typeof keys>(ls, keys);
typed.a.set(1);
ls.set("rich", { when: new Date(), ids: new Set([1n, 2n]) });
```

**BREAKING (D12):** when explicitly supplying the batchFast value type V, also supply K (as above). Supplying only V no longer accepts nonempty keys: K defaults to readonly never[] to prevent silently losing key constraints. Inference without explicit generics still preserves keys. batchFast returns a null-prototype object.

JSONX supports Date / Map / Set / bigint, reads existing rich-type tags, and escapes new ordinary objects containing `__jt__`. Circular references remain unsupported.

## Codecs

`codec(password?)`, `codecBase64(password?)`, and `codecAtob(password?)` implement `Codec.encode(string): string` and `Codec.decode(string): string | null`. They provide obfuscation. Use `{ codeable:true, codec:codec("pw") }` for values; add enckey for keys. The default codec transforms UTF-16 code units; base64 variants use UTF-8 and share a format.

Passwords are not security boundaries: different passwords can collide, and the base64 variants can lose lone surrogate code units in encoded keys. Codec format changes for these limits (D11) are deferred. Decode failure is treated as corrupt data; changing a password requires a migration strategy and is not guaranteed to reject every old payload.

## IndexedDB and custom backends

`new Idb(name?)` defaults to `"@codejoo/storage"`. Public backend methods return Promises: `get`, `set`, `remove`, `clear`, `key`, `keys`, `length`, `update`, `destroy`. Writes resolve at transaction commit; abort rejects with an AbortError fallback if needed. Closed connections reopen on later operations. Open failures are local to the instance and trigger 1/2/4…second retry delays, capped at 30 seconds, checked on the next operation. Writes made to fallback memory are not migrated when IndexedDB recovers.

`AsyncStorage` is accepted by the db option. Its optional atomic primitive is:

```ts
update?(key: string,
  fn: (current: string | null) => string | null | undefined
): Promise<string | null>;
```

Read and synchronously call the pure fn inside one backend transaction: string writes, null deletes, undefined preserves; resolve the final stored string/null after commit. No await or IO inside fn; exceptions must roll back/reject. Idb implements it. The handler uses it for readonly and conditional read-side mutations (renewal/expired or corrupt cleanup/purge). Without it, only same-handler version protection applies. Batch operations remain per-key operations, without an all-or-nothing transaction.

## crossTab v2

`crossTab(handler, channel?)` accepts a synchronous handler and returns an idempotent stop function. It inspects the actual backend: only this module's Memory fallback with kind local participates. Native localStorage, Idb, other backends or missing BroadcastChannel make it a no-op. Both native and fallback ss are excluded, with one warning per handler; duplicate mounting is a no-op. Different handlers on one channel warn; assign distinct channels yourself.

The v2 message is `{ v:2, op, ns, key?, payload?, expireAt?, ts, from }`, with a logical key, required final payload string for set, and optional absolute expiry. Committed payloads include sliding renewals; replay does not grant a fresh TTL. Receivers validate shapes/times/current namespace and ignore malformed and self-originated messages. An expired SET replays as REMOVE with its original `(ts, from)` stamp, removing older values and recording the stamp so an older permanent value cannot remain. Per-namespace/key LWW compares `(ts, from)`; clear preserves keys known to be newer. Replay invalidates memo without rebroadcasting. Identity generation does not require randomUUID; it falls back to randomness and time when that method is unavailable.

**BREAKING:** old array-protocol and v2 tabs ignore each other; update/reload every participating tab. There is no strong consistency, universal convergence, startup snapshot or offline replay guarantee. Coordinate namespace switches in the application and explicitly call stop to release the channel.

```ts
import { factory, crossTab } from "@codejoo/storage";
const { ls } = factory();
const stop = crossTab(ls, "my-app-cache");
stop();
```

## Debug snapshot

```ts
import { factory, codec, Idb } from "@codejoo/storage";
import { debug } from "@codejoo/storage/debug";

const { ls, db } = factory({
  namespace: "app", db: new Idb(), codeable: true, codec: codec("pw"), enckey: true,
});
debug(ls); // null-prototype plaintext snapshot, e.g. { "app:key": value }
await debug(db);
```

Debug captures the starting keyspace and skips the legacy `_$debug` entry. It does not persist the snapshot or create a debug key. Its normal read path can delete expired/corrupt data and renew sliding TTL; it is not side-effect-free. It is exported only from the debug subpath.

## Runtime and output

Import does not probe storage. First use of the internal supported fields probes independently, catches throwing browser getters, uses temporary random keys and caches results. No-window imports and memory fallback are supported; Worker/SSR persistence is outside scope. Expiration is lazy; keys/count can include entries not yet purged. Storage quotas remain browser-controlled.

| Output | Use |
| --- | --- |
| `dist/esm/*.mjs` | Per-module ESM, default import, tree-shakeable. |
| `dist/index.mjs` | Single ESM bundle. |
| `dist/index.min.js` | Minified ESM via the min subpath. |

Build size for the pending release: `dist/index.min.js` 17,240 B (0.1.2: 11,192 B), gzip -9 6,843 B (0.1.2: 4,537 B). Only 0.2.0 is planned; see [CHANGELOG](./CHANGELOG.md) for migration; package version is changed only at release time.

## Tests and acceptance

Run from this package directory:

```sh
pnpm test --run
pnpm test:node
pnpm test:cov
pnpm accept
pnpm gate
pnpm lint
```

`pnpm test` runs real Chromium/Playwright browser tests (`test/*.browser.test.ts`); add --run for a single pass. test:node runs `test/*.node.test.ts`. test:cov merges browser and Node projects in one Vitest run into coverage. gate runs coverage, checks lines 100% / branches >=95%, then validates the acceptance matrix. accept performs the bidirectional test/matrix check. These commands exist; their existence does not mean the current branch passes every gate. Lint and build are separate checks.

`test/backends.ts` supplies five backend fixtures; `test/helpers/clock.ts` controls Date. See [test/ACCEPTANCE.md](./test/ACCEPTANCE.md) for INV/BUG/API mappings and exemption rules; [test/types.check.ts](./test/types.check.ts) is checked through lint. The interactive [playground](./test/manual.html) runs with `pnpm dev` at `/test/manual.html`.

## License

MIT
