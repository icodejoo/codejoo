---
name: codejoo-storage
description: Use when developing or reviewing apps/storage (@codejoo/storage). Covers the actual module boundaries, storage consistency invariants, and browser/Node acceptance workflow.
---

# @codejoo/storage development

Read `src/` as the authority; concurrent work can change interfaces. Public exports are in `src/index.ts`; debug has the separate `@codejoo/storage/debug` export. Detailed behavior and migration examples live in [ARCHITECTURE.md](../../../ARCHITECTURE.md) and the paired READMEs (paths relative to this skill directory).

## Module map

All entries below are under `src/`.

| File | Decision-relevant role |
| --- | --- |
| `interface.ts` | `BaseStorageOptions`, per-call `StorageOptions`, `StorageEntity`, `Codec`, `SyncStore`, `AsyncStorage`, `MemoCache`. Async update is optional; readonly kind identifies local/session/idb. |
| `maybe.ts` | `Maybe`, `isPromise`, `chain`, `attempt`, `all`: one synchronous/asynchronous orchestration path. |
| `keyspace.ts` | `keyspace`: immutable prefix/full/owns/logical snapshot; namespace escaping and bounded forward/reverse conversion caches. |
| `entity.ts` | `mkEntity`, `parseEntity`, `isExpired`, `renewOf`, `typeMismatch`: shape, expiry, renewal, lightweight type checks. |
| `errors.ts` | `StorageErrorInfo`, `StorageOperation`, `report`; callback errors propagate. |
| `hub.ts` | `memoHub`, `register`, `invalidate`: backend-identity invalidation, storage event listener and opt-in IDB broadcast. This module performs IO. |
| `proxy.ts` | `proxy`, `Handlers`, `Result`, `MGet`; orchestration, per-key versions, global generation, memo and internal COMMIT/SNAPSHOT/STORE/APPLY hooks (STORE reads the backend; APPLY silently replays strings). Hooks are not public index exports. |
| `core.ts` | `factory` returns ls/ss/db/destroy/setNamespace; native adapt, separate shared ls/ss fallback stores and separate per-handler memo. Unconfigured db methods fail; factory.destroy skips that db. |
| `helper.ts` | `supported.storage`, `supported.session`, `supported.indexedDB`: independent lazy cached probes, guarded browser getters. |
| `memory.ts` | `Memory`: Map backend used in distinct roles as memo or fallback, never both at once. |
| `idb.ts` | `Idb`: transactions, atomic update, reconnect, instance-level backoff and database/store-scoped shared fallback. No full mirror. |
| `codec.ts` | `codec`, `codecBase64`, `codecAtob`: obfuscation, not secure encryption. decode returns null on detected failure; password collisions remain possible. |
| `serialization.ts` | `JSONX`: rich type tags plus ordinary __jt__ object escaping; old rich-type tags remain readable. |
| `fast.ts` | `fast`, `lazy`, `batchFast`; sync/async accessors; explicit V requires explicit K for nonempty batch keys. |
| `debug.ts` | `debug` uses captured SNAPSHOT; null-prototype result, skips legacy debug key, normal read side effects. |
| `sync.ts` | `crossTab`; v2 syncs only local Memory fallback, excludes session, broadcasts successful commit strings/absolute expiry, and compares `(ts, from)` per namespace/key. Message fields are v/op/ns/key/payload/expireAt/ts/from, with optional fields defined in sync.ts. |
| `index.ts` | Public exports, excludes debug and proxy internals. |

## Invariants

- Backend vocabulary is get/set/remove. Async detection is `typeof st.length === "function"`; call length bound to the backend. `Result<S,T>` maps AsyncStorage to Promise, sync storage to T.
- Capture keyspace at operation start. Writes check only the per-key token before dispatch; read-side mutations and memo refill check token, generation and cacheable. Already-dispatched backend requests cannot be undone.
- clear/setNamespace/destroy advance generation. setNamespace/destroy preserve initiated writes in their starting keyspace. Async set evicts memo and dispatches immediately without a gate; every same-key write reaches the FIFO backend in order. During clear, queued writes and get wait the same hop. Single-key evict marks tokens with pending writes stale for reads, preserving writable identity; otherwise it deletes the token. Release references and readonly queues after completion.
- Plain clear calls backend clear, and plain length/key directly query the backend. Scoped clear deletes all owned old keys and reuses queued-write tokens. get/set/keys/length/key/purge and snapshot queries wait for the same-handler clear barrier. The barrier consumes failure; clear itself still propagates callback/enumeration errors. Sync backends retain synchronous returns.
- Scoped clear has no per-key publish/COMMIT. Emit one clear COMMIT only if every deletion succeeds; always publish Hub null on completion, including failures. Plain clear also emits COMMIT only on success. Clear is not a transaction or cross-handler lock.
- Hub opens an opt-in channel lazily on connect/publish and reuses it until destroy. Same-name Idb area/fallback registries retain entries for the module lifetime.
- cloned:true clones all ordinary-mode object reads, including non-memo reads; uncloneable values may throw. Module-level Memory/Map/WeakMap/Set initializers use PURE annotations with sideEffects:false for tree-shaking; ./min remains a full entry.
- No stale read may renew/delete a newer value. Across independent handlers this requires optional transactional update; version maps alone are not cross-instance locks.
- Cache only after successful backend work. Renewal creates a fresh envelope, never mutates a memo-shared envelope before commit. Per-call memoized:false successful writes evict old cache; per-call memoized:true entries must also register for invalidation.
- Fallback backends and memo must be distinct instances. ls and ss fallbacks are distinct module-level singletons; Idb fallback is shared by database/store name within the same module realm. destroy clears memo/connections, never backend fallback data.
- Hub uses area ?? store identity. Same-tab handler writes publish; native storage events keep browser session scoping. Same-tab direct native writes can leave stale memo. Idb objects in one module/realm share area by database name and automatically invalidate same-tab peer memo; cross-tab invalidation requires broadcast:true and BroadcastChannel. Close subscriptions on destroy.
- Envelope is a non-array object with an own value field and finite numeric metadata if present; legacy ttl:null/expireAt:null mean absent, but createdAt:null is corrupt. Default JSON drops undefined values; reading such a missing-value envelope is corrupt, even after a memoized set.
- isExpired requires createdAt and expireAt and uses now >= expireAt. renewOf also requires positive ttl and renews at remaining lifetime <=90%. Invalid ttl warns/ignores; invalid absolute expiry skips the write except sliding+ttl can replace a past deadline.
- Except normal expiry, only corrupt read handling deletes data; type mismatch returns the default, reports type and preserves storage. Checks cover primitive defaults/arrays, not object schemas. Stored null with a primitive default silently returns that default without a type report; an array default still reports mismatch. User onError exceptions can interrupt subsequent cleanup.
- readonly treats a valid stored null as present. Same async handler serializes same-key readonly writes; cross-handler atomicity requires backend update.
- AsyncStorage.update reads/calls synchronous pure fn/writes in one transaction: string writes, null deletes, undefined preserves; resolve final string/null after commit. fn must not await or perform IO; thrown exceptions reject and roll back.
- Namespace escaping is percent first, then colon; append one colon separator. Escape namespace only, not logical keys. namespace getter is the escaped prefix. enckey encodes the entire prefix+key deterministically and does not require codeable.
- keys/length/key/clear/purge use the same owns rule. key(index) is deprecated. raw requires string writes, skips envelopes/value encoding/TTL; purge leaves raw data alone.
- Batch operations are per-key, not all-or-nothing. Never use keys.map(get): the array index would become a default value. Use an explicit lambda.
- force:false skips quota cleanup/retry and reports wrapped backend failure. force:true cleanup/retry applies to synchronous set, including readonly. Renewal never performs quota cleanup/retry. Serialization without onError throws/rejects; callbacks always propagate their own exceptions.
- onError receives kind (write/serialize/corrupt/type/abort), op, logical key, original error. Preserve error identity. Do not claim every read/enumeration error is wrapped.
- JSONX escapes newly written ordinary __jt__ objects and preserves rich types; no circular references. batchFast/debug return null-prototype objects so __proto__ is an ordinary key.
- debug is a separate import, captures namespace once, and does not save its snapshot. Reads may delete expired/corrupt entries and renew sliding TTL.
- Idb resolves writes only at transaction complete. Abort needs an AbortError fallback. Open failure does not mutate supported.indexedDB; retry is operation-triggered exponential backoff capped at 30s. Restored IDB does not import memory-only writes.
- Codec is not an isolation boundary. Keep explicitly empty passwords; base64 lone-surrogate keys and password collisions remain known limits (D11 deferred).
- Session isolation must survive crossTab. v2 uses actual STORE identity and current-module Memory kind local only; session always skips/warns. COMMIT broadcasts successful writes including renewal; APPLY replays without rebroadcast. Validate messages; replay expired SET as REMOVE with its original stamp. randomUUID is optional with randomness/time fallback. LWW clear keeps known-newer keys; old array/v2 tabs ignore each other. There is no strong consistency or universal convergence guarantee. Call the plugin stop function explicitly to close its channel.
- Keep runtime messages in English. Preserve es2022; lowering syntax target adds helpers without providing the required runtime APIs.

## Tests and gates

Browser tests use real Chromium/Playwright (`vitest.browser.config.ts`, `test/*.browser.test.ts`), Node tests use `vitest.node.config.ts` / `test/*.node.test.ts`. Prefix new suites by responsibility: core- for orchestration/pure rules, platform- for browser adapters/IDB/serialization, matrix- for shared semantics, sync- for protocol. `test/core-x1.browser.test.ts` covers X1 lifecycle/clear races, historical metadata, null defaults, error/commit behavior and sharing. `test/core-types.node.test.ts` covers type-check rules; `test/core-pure.node.test.ts` covers pure helpers; `test/sync-crosstab.browser.test.ts` covers protocol cases. Do not invent a filename before checking it exists.

`test/backends.ts` exports BACKENDS and make for five backend fixtures. Await operations even for synchronous fixtures; always cleanup. Memory fallback fixtures use isolated iframe realms: test module-level sharing by creating multiple factories in the same realm. `test/helpers/clock.ts` exports clock for Date-only fake timers without disrupting IDB. `test/types.check.ts` covers type contracts through the lint/type-check chain.

Run from the package directory:

```sh
pnpm test --run
pnpm test:node
pnpm test:cov
pnpm test:infra
pnpm accept
pnpm gate
pnpm lint
```

`test:cov` uses `scripts/vitest.all.config.ts` to merge browser/Node coverage in one Vitest run. `gate` runs coverage, `scripts/coverage-gate.mjs` (lines 100%, branches >=95%), and `scripts/check-acceptance.mjs`. It does not run lint/build. Zero-denominator/empty reports and unregistered V8 ignores fail. `test/ACCEPTANCE.md` maps INV/BUG/API to fully expanded test titles; keep it aligned when adding tests. See that file for exact syntax and exemption rules.

`pnpm lint` checks `test/types.check.ts`; `node scripts/check-type-chain.mjs` verifies the lint/type assertion chain. Do not run standalone type checking or vue-tsc. `pnpm build` runs vp pack and post-minify and cleans dist; in a concurrent session only the assigned build owner runs it. Outputs: dist/esm/*.mjs, dist/index.mjs, dist/index.min.js; all pack targets stay es2022. `pnpm dev` serves test/manual.html.

## Extending behavior

Add instance options to BaseStorageOptions or per-call options to StorageOptions. Follow the actual proxy set/get orchestration and extracted helpers (mkEntity/parseEntity/renewOf/keyspace), keeping Maybe composition. Add a regression test in the appropriate prefix/environment, update the acceptance mapping and both same-structure READMEs. Read interface.ts/proxy.ts/sync.ts again before finalizing documentation during concurrent work. Update only files authorized in the active task.
