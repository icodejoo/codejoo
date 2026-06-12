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
| `debug.ts` | `debug(handler)` — standalone (tree-shakeable) decrypted snapshot. |
| `core.ts` | `factory(opts?)` → `{ ls, ss, db, destroy }`; adapts native Storage to the `get/set/remove` vocabulary; `unimpl()` placeholder for unprovided `db`; `destroy()` releases all three layers (returns Promise; keeps persisted data). |
| `helper.ts` | `supported` = `{ storage, indexedDB }` runtime feature flags (mutable; Idb flips `indexedDB` on runtime failure). |

## Key invariants & gotchas (learned the hard way — keep these)

- **Backend vocabulary is `get/set/remove`** (not `getItem/...`). Native localStorage is adapted in `core.ts`’s `adapt()`. The public `Handlers` API is also `get/set/remove`.
- **`Result<S,T>` = `S extends AsyncStorage ? Promise<T> : T`.** Sync vs async is driven by generics; the proxy detects async at runtime via `typeof st.length === "function"`.
- **`st.length()` must be called bound** (`(st as {length()}).length()`), never `const l = st.length; l()` — IdbStorage uses `this`.
- **`keys.map(get)` leaks the array index as `get`’s `defaultValue`** — always `keys.map(k => get(k))`.
- **`memo` is shared module-level** (`lsMemo/ssMemo/dbMemo` in core.ts) across all `buildStorage()` instances. Tests must isolate via `handler.clear()` (clears memo+backend), not raw `localStorage.clear()` — but note `clear()` is **scoped**: with `namespace`/`enckey` it removes only keys the instance owns (`owns()` in settings); count-based assertions (`localStorage.length`) need a raw `localStorage.clear()` first.
- **`clear()`/quota-purge are scoped by `owns()`** (namespace prefix; enckey-decodable). `purgeExpired` additionally requires `createdAt` in the entity so foreign JSON that happens to have an `expireAt` field is never deleted.
- **`memoized` gates memo writes** (opt-in cache; not a full mirror). Reads still check memo first (cheap if empty).
- **`enckey`** encrypts the storage key via `codec.encode` (deterministic, so the same logical key → same storage key). `fullKey`/`decKey` are the single chokepoints.
- **`sliding`** renews `expireAt = now + entity.ttl` on read hit — **requires a `ttl` to have been set**, else there’s nothing to renew. The write-back is **skipped while >90% of the ttl remains** (anti write-amplification); tests asserting renewal must first consume >10% of the ttl.
- **`Idb` self-heals closed connections**: `open()` hooks `onclose`/`onversionchange` to drop the cached handle so the next op re-opens. Don't cache `req.result` elsewhere without those hooks.
- **`debug` is a separate import** (not on the handler) to keep core small/tree-shakeable. It enumerates via `handler.length`+`handler.key(i)`, reads via `handler.get`, preserves namespace, and stashes the snapshot under `"_$debug"`.

## Build & test

- `pnpm build` → `vp pack` (vite-plus/tsdown) + `scripts/post-minify.mjs`. Outputs: `dist/index.mjs` (bundle), `dist/index.min.js` (min), `dist/esm/*.mjs` (per-module, tree-shakeable; the package `import` target).
- `vite.config.ts` has 3 pack entries (bundle+dts, min, unbundled `dist/esm`), all `target: "es2022"` — don't lower it: class fields/async would get downleveled and pull `@oxc-project/runtime` helpers into `dist/esm` (~1KB+ of pure bloat). `package.json` `sideEffects: false`.
- Type-check: `./node_modules/.bin/tsc --noEmit -p tsconfig.json` (project uses `erasableSyntaxOnly` — no enums/param-properties/namespaces).
- **Tests are browser-based**, not vitest-by-default: `test/index.html` (auto suite, `test/suite.mjs`) + `test/manual.html` (interactive). Run `pnpm dev`, open `/test/` (auto) or `/test/manual.html`. The suite imports `../src/index.ts` (Vite transforms TS, no build needed).
- To verify headlessly: start `pnpm dev` (background), then drive with Playwright (`apps/*/node_modules/.bin` has it) — navigate to `http://localhost:<port>/test/`, wait for `#summary` to leave "Running", read pass/fail. **Always add a test for new features and run it** — the suite has caught several real bugs (unimpl throwing on property read, `st.get` vs `getItem`, length `this`-loss, mget index leak).

## Adding an option (pattern)

1. Add to `BaseStorageOptions` (instance) or `StorageOptions` (per-call) in `interface.ts`.
2. Resolve it in `settings()` (instance) or `writeArgs()` (per-call) in `proxy.ts`.
3. Apply in `get`/`set`/`resolve`/`buildEntity` as appropriate (mind sync+async via `chain`/`out`).
4. Add a test group in `test/suite.mjs`; document a row in both READMEs (EN + zh-CN).
