---
name: codejoo-storage
description: Use when working in apps/storage (@codejoo/storage) — a unified, type-safe wrapper over localStorage/sessionStorage/IndexedDB with TTL, sliding expiry, namespaces, pluggable serialization (Date/Map/Set/bigint), obfuscation codec, opt-in memo cache, key-bound shortcuts, batch ops, readonly, key encryption, and a debug snapshot. Covers the architecture, invariants, and how to extend/test it.
---

# @codejoo/storage

A tiny ESM library: **one unified API over three backends**. Sync backends (`localStorage`/`sessionStorage`) return values; the async IndexedDB backend returns Promises — decided by **generics, one code path**.

## File map (src/)

| File | Role |
| --- | --- |
| `interface.ts` | All types: `BaseStorageOptions`, `StorageOptions` (per-call), `StorageEntity`, `Codec`, `SyncStore`, `AsyncStorage`, `MemoCache`. |
| `proxy.ts` | **Core**. `proxy<S>(storage, memo, opts)` → `Handlers<S>`. Shared helpers `settings`/`writeArgs`/`buildEntity`, sync/async combinators `chain`/`attempt`/`out`, and exported `Result<S,T>` + `Handlers<S>`. |
| `memory.ts` | `Memory` — plain Map-based sync store (cache + native-unavailable fallback + Idb mirror). |
| `idb.ts` | `Idb` — **async** IndexedDB backend (no full mirror; falls back to `Memory` when IDB unusable). |
| `codec.ts` | Three variants. `codec(password?)` (default) — branch-free 10-bit XOR over UTF-16 code units: k ≤ 0x3FF only perturbs the low 10 bits so surrogates stay valid by construction (high 6 bits untouched) — no escape logic; 1 MAGIC^k header unit is the validity tag (wrong-pw deterministic null; foreign false-accept 1/65536, deserialize is the second net). Output = input + 1 unit; via `utf-16le` TextDecoder (`ignoreBOM` REQUIRED). Also `codecBase64` (native toBase64, atob/btoa polyfill fallback, rotated base64url) and `codecAtob` (always-polyfill, same format as codecBase64). **Obfuscation, not encryption.** decode→null is load-bearing (`load()` stale-clean + enckey `owns()`). |
| `serialization.ts` | `JSONX` — JSON-compatible, round-trips Date/Map/Set/bigint via a `__jt__` tag. |
| `fast.ts` | `fast`/`lazy`/`batchFast` — key-bound shortcut accessors. |
| `debug.ts` | `debug(handler)` — decrypted snapshot. NOT exported from index.ts: shipped via the `"./debug"` subpath (`@codejoo/storage/debug`) so single-file bundles exclude it; it's a separate pack entry in vite.config's unbundle target (would otherwise be unreachable and not emitted). |
| `core.ts` | `factory(opts?)` → `{ ls, ss, db, destroy }`; adapts native Storage to the `get/set/remove` vocabulary; `unimpl()` placeholder for unprovided `db` (any method call throws); `destroy()` releases all three layers (returns Promise; keeps persisted data) — skips `db.destroy()` entirely when `db` was never configured, since calling any `unimpl()` method throws synchronously. |
| `helper.ts` | `supported` = `{ storage, indexedDB }` runtime feature flags (mutable; Idb flips `indexedDB` on runtime failure). |

## Key invariants & gotchas (learned the hard way — keep these)

- **Backend vocabulary is `get/set/remove`** (not `getItem/...`). Native localStorage is adapted in `core.ts`’s `adapt()`. The public `Handlers` API is also `get/set/remove`.
- **`Result<S,T>` = `S extends AsyncStorage ? Promise<T> : T`.** Sync vs async is driven by generics; the proxy detects async at runtime via `typeof st.length === "function"`.
- **`st.length()` must be called bound** (`(st as {length()}).length()`), never `const l = st.length; l()` — IdbStorage uses `this`.
- **`keys.map(get)` leaks the array index as `get`’s `defaultValue`** — always `keys.map(k => get(k))`.
- **`memo` is per-`factory()` instance** (`lsMemo/ssMemo/dbMemo` created inside `factory()` in core.ts): each `factory()` call gets its own `ls/ss/db` read caches and separate instances do not share memo (no cross-instance reads). Tests must isolate via `handler.clear()` (clears memo+backend), not raw `localStorage.clear()` — but note `clear()` is **scoped**: with `namespace`/`enckey` it removes only keys the instance owns (`owns()`); count-based assertions (`localStorage.length`) need a raw `localStorage.clear()` first. Also note `length` is scoped the same way: with `namespace`/`enckey` it counts only owned keys, otherwise the backend's global count.
- **The memo `Memory` and the native-storage-unavailable fallback `Memory` must be two separate instances.** `core.ts`'s `factory()` passes `new Memory()` as the `ls`/`ss` backend when `supported.storage` is false — never the same instance as `lsMemo`/`ssMemo`. They were aliased once (same Map doubling as backend and cache); that made `destroy()`/`clear()`'s `memo.clear()` wipe the "persisted" data itself, and a `memoized` write clobber the backend's JSON string with the raw entity object. If you ever refactor `factory()`, keep this a hard two-instance invariant.
- **`clear()`/quota-purge are scoped by `owns()`** (namespace prefix; enckey-decodable). `purgeExpired`'s dead-check and `resolve()`'s lazy-expire-on-read share one `isExpired(entity, now)` predicate that additionally requires `createdAt` in the entity, so foreign JSON that happens to have an `expireAt` field is never deleted by either path — keep them sharing the one predicate rather than re-deriving it twice.
- **`memoized` gates memo writes** (opt-in cache; not a full mirror). Reads still check memo first (cheap if empty). The sliding-renewal memo write in `resolve()` is gated on `persist()` actually succeeding (mirrors `write()`'s `if (ok && memoized)`) — never write the renewed entity into memo before the backend write confirms, or memo and backend diverge on `expireAt` after a failed write.
- **`enckey`** encrypts the storage key via `codec.encode` (deterministic, so the same logical key → same storage key). `fullKey`/`decKey` are the single chokepoints. `key(index)` also respects `namespace`/`enckey` scoping (goes through `ownKeys()` instead of a raw backend index) so it can't return a foreign or undecryptable key — same scoping contract as `keys()`/`length`/`clear()`.
- **`sliding`** renews `expireAt = now + entity.ttl` on read hit — **requires a `ttl` to have been set**, else there’s nothing to renew. The write-back is **skipped while >90% of the ttl remains** (anti write-amplification); tests asserting renewal must first consume >10% of the ttl.
- **`Idb` self-heals closed connections**: `open()` hooks `onclose`/`onversionchange` to drop the cached handle so the next op re-opens. Don't cache `req.result` elsewhere without those hooks. The in-memory fallback (`this.mem`, set when IndexedDB is unusable) must only ever be created once — `database()`'s failure path uses `this.mem ??= new Memory()`, not a plain assignment, so concurrent calls racing the same rejected `open()` don't each hand out a fresh Map and orphan one another's writes. `destroy()` must never null `this.mem` either — it's the actual data when IDB is unavailable, not a disposable handle.
- **`debug` is a separate import** (not on the handler) to keep core small/tree-shakeable. It enumerates via `handler.keys()` (owned keys only), reads via `handler.get`, preserves namespace, and returns a `{ "namespace:key": value }` snapshot. It does **not** write the snapshot back to `"_$debug"` (a legacy `DEBUG_KEY` constant is kept only to skip stale leftover data), so it never pollutes `keys()`/`length` — but it is **not** side-effect-free in general: it calls `handler.get()`, so it inherits lazy-expiry deletion and sliding-TTL renewal writes like any other read.
- **`onError` makes write failures observable**: `persist()` calls `opts.onError({ op:"set", key, error })` when provided, else `console.error`. `set` returns `void`, so without `onError` quota/force-retry failures are silent (no throw — unlike native localStorage). Batch `set` calls it once per failing key.
- **Invalid `ttl` is warned and ignored**: `mkEntity` drops a `ttl` that is `≤0` / `NaN` / `Infinity` (would otherwise expire-on-write or serialize away into never-expiring) — the value still persists, just without expiry.
- **Runtime warnings/errors are in English** (`[storage] ...`).

## Build & test

- `pnpm build` → `vp pack` (vite-plus/tsdown) + `scripts/post-minify.mjs`. Outputs: `dist/index.mjs` (bundle), `dist/index.min.js` (min), `dist/esm/*.mjs` (per-module, tree-shakeable; the package `import` target).
- `vite.config.ts` has 3 pack entries (bundle+dts, min, unbundled `dist/esm`), all `target: "es2022"` — don't lower it: class fields/async would get downleveled and pull `@oxc-project/runtime` helpers into `dist/esm` (~1KB+ of pure bloat). `package.json` `sideEffects: false`.
- Type-check: `./node_modules/.bin/tsc --noEmit -p tsconfig.json` (project uses `erasableSyntaxOnly` — no enums/param-properties/namespaces).
- **Tests run in a real browser via vitest browser-mode**: `pnpm test` (config `vitest.browser.config.ts`) runs `test/*.browser.test.ts` in headless **Chromium** (Playwright) against real `localStorage` / `sessionStorage` / `IndexedDB` / `BroadcastChannel` — not jsdom. Current suites: `sync.browser.test.ts`, `idb.browser.test.ts`, `codec.browser.test.ts`, `plugins.browser.test.ts`, `apichanges.browser.test.ts`. The old `test/index.html` + `test/suite.mjs` browser page is gone. **Always add a test for new features and run it** — the suite has caught several real bugs (unimpl throwing on property read, `st.get` vs `getItem`, length `this`-loss, mget index leak).
- `test/manual.html` is an interactive playground (kept): `pnpm dev`, open `/test/manual.html`.

## Adding an option (pattern)

1. Add to `BaseStorageOptions` (instance) or `StorageOptions` (per-call) in `interface.ts`.
2. Resolve it in `settings()` (instance) or `writeArgs()` (per-call) in `proxy.ts`.
3. Apply in `get`/`set`/`resolve`/`buildEntity` as appropriate (mind sync+async via `chain`/`out`).
4. Add a test in the relevant `test/*.browser.test.ts` suite; document a row in both READMEs (EN + zh-CN).
