---
name: layerman
description: >-
  Work on @codejoo/layerman (apps/layerman) — the framework-agnostic
  HEADLESS overlay/dialog/modal/bottom-sheet/drawer queue manager (factory
  createLayerman). Read BEFORE modifying src/index.ts, its tests, or the READMEs.
  Covers architecture, the non-obvious invariants tests depend on, and the verify workflow.
  Triggers on: overlay, dialog, modal, bottomsheet, drawer, queue, priority, replace,
  overlap, affix, cooldown, resolve, setContext, subscribe, headless popup manager.
---

# @codejoo/layerman

`apps/layerman` — a **framework-agnostic, headless** overlay queue manager. Package
`@codejoo/layerman`, factory **`createLayerman()`**. It manages *when/which*
overlays are active — queue, priority, conditions, cooldown, backend-driven resolution — and
**touches no DOM/UI/animation whatsoever**. The host renders the `active` list; the package is
pure logic with **zero runtime deps**.

Core implementation is **two files**: `src/index.ts` (~1360 lines: public types + `LayermanImpl` — queues,
scheduler, lifecycle, batching, notification, `destroy`, `checkInvariants()`) and `src/cooldown.ts`
(~260 lines: `CooldownStore`, bucket helpers, record validation, `defaultStorage()`; imported by
`index.ts`, **not** a package entry — its types are re-exported from `index.ts`). `LayermanImpl` keeps
its state in one class on purpose; only the cooldown store was split out. Optional
**framework adapters** (each its own subpath + OPTIONAL peer dep, all thin reactive bridges over the
core's `subscribe`+`getSnapshot`, mirroring the same `useOverlayState`/`useOverlays`/`useOverlay(id,
defaults?, om?)` + provider + `useCurrentOverlay`/`provideCurrentOverlay` shape):
- `src/vue.ts` → `/vue` (shallowRef; adds `model` v-model bridge)
- `src/react.ts` → `/react` (`useSyncExternalStore`; Context provider; no `model`; current-overlay provider is
  **`CurrentOverlayProvider`** (capitalised, JSX-safe) — lowercase `provideCurrentOverlay` is a
  `@deprecated` alias that JSX treats as a native tag)
- `src/svelte.ts` → `/svelte` (`svelte/store` readable/derived; Svelte 4/5-safe, no runes compiler)
- `src/solid.ts` → `/solid` (`createSignal`+`onCleanup`; plain derived accessors, NOT `createMemo` —
  under node/SSR-build test `createMemo` freezes)

Tests (vitest; **14 files, 862 passed, 0 failed, no expected fail** — measured with `pnpm test`; counts drift as tests are added, re-run to refresh):
- core: `layerman.test.ts` (68), `coverage-core.test.ts` (25), `invariants.test.ts` (36 — the
  `checkInvariants()` checker, its **reverse-break cases** that corrupt internals on purpose, and fixed-bug
  regressions), `fuzz.test.ts` (401 — see Verify workflow), `regressions.test.ts` (149 — final-review defect
  net, no `it.fails` left, see Verify workflow), `cooldown-store.test.ts` (42), `coverage-gaps.test.ts` (7 — the last uncovered lines, brings src to 100%).
- adapters: `{vue,react,svelte,solid}.test.ts` (21/10/13/11), `adapters-contract.test.ts` (20 — one contract
  run against all four adapters), `coverage-adapters.test.ts` (56).
- `types.test.ts` (3; type-level via `expectTypeOf`, gated by tsc since tsconfig includes `test/**`).
`react.test.ts`/contract/coverage-adapters use a `/** @vitest-environment jsdom */` docblock +
`@testing-library/react`; the rest are node (svelte = store contract, solid = `createRoot`).
Public store/query methods (`subscribe`/`getSnapshot`/`getServerSnapshot`/`get`) are **bound in the
constructor** so consumers (e.g. React `useSyncExternalStore`) can pass them as bare refs without
losing `this`.

There is also a Flutter port at `D:\workspaces\dart-labs\layerman` (separate repo) — NOT a
headless port; it embraces Flutter (`Overlay`/`OverlayEntry`, `LayermanScope`), `show()` returns
`Future<T?>`. See its own memory note.

## Vue adapter (`src/vue.ts`)

Pure bridge, no components. `useOverlayState(om?)` wraps `subscribe`+`getSnapshot` in a
`shallowRef` (the snapshot's stable reference means assignment triggers reactivity), auto-unsub via
`onScopeDispose`. **Throws if called with no active effect scope** (`getCurrentScope()` falsy) —
there'd be nowhere to hang the cleanup, so it fails loudly instead of leaking the subscription for
the manager's lifetime; always call it inside `setup()` or an explicit `effectScope()`.
`useOverlays(om?)` → reactive `active`/`queued`. `useOverlay(id, defaults?, om?)` → per-id
`{ instance, visible, model, phase, open, close, remove, resolve, reject, pause, resume }` for the
template+ref idiom. `defaults` (2nd arg) is `MaybeRefOrGetter<Omit<OverlayConfig, "id">>` — the FULL core config (minus
id), merged into every open (`model=true`/`open()`/ref) and resolved with `toValue` per open (so it
accepts a plain object, `ref`, or getter; read fresh each open, not tracked). Declarative/v-model
overlays carry `overlap`/`replace`/`priority`/`cooldown`/… this way — a `v-model` overlay should use
`overlap` or `replace` so it enters `active` synchronously (a plain queued overlay makes `model`'s
getter read `false` → v-model bounce). Function fields (`when`/`resolve`/hooks) sit inside the
resolved object, so `toValue` never mis-invokes them. **`useCurrentOverlay(om?)`** injects the current
overlay id (provided per-item by `provideCurrentOverlay(id)` in a central-renderer wrapper) and returns
the same handle without threading `id` — for the `<component :is>` idiom. Manager resolution is **plugin-default + param-override**: pass `om` explicitly,
else it `inject`s the one provided by `createLayermanPlugin(om)` / `provideLayerman(om)`.

**`model` is a `WritableComputedRef<boolean>` for third-party dialogs that expose only `v-model`**
(ElDialog/Vant/AntDV): get = is-active; `set(true)` = `open()` (skipped if already active or queued).
Core's public state has no `resolving` phase (invariant 6 below) — an in-flight `resolve()` entry is
invisible to both `active` and `queued`, so the active/queued check alone can't detect "already
busy" while resolving. `set(true)` guards this with a local `opening` latch: it flips on right
before calling `open()` and only flips off once that `open()`'s `result` settles — a second
`set(true)` fired before then (e.g. a double-click racing an in-flight `resolve()`) is a no-op
instead of re-`open()`ing and discarding the in-flight resolve via `discardActive`.
`set(false)` branches on whether the instance is currently shown: if it's still **queued** (never
opened), it calls `remove()` directly — `beforeClose` only guards an already-*shown* close. If it **is**
shown (open/closing), `closeModel` records `{ key: instanceKey, unsubscribe }`, subscribes to the manager,
calls `close()` (respects `beforeClose`), and `remove()`s **only once the same `instanceKey` reaches
`closing`** (it checks once synchronously right after `close()` — the no-guard case — and again on every
notification). If the guard returns `false`/throws (the wrapped `beforeClose` calls `cancel`) or the
instance is replaced (different `instanceKey`) the pending close is unsubscribed, so a stale decision never
removes a new instance. This is deliberate: `closing` keeps the instance in `active` so a **self-rendered**
overlay can play its exit animation, but a third-party dialog owns its own animation and only needs the
bound boolean to flip `false`; removing at once avoids the laggy 300ms auto-remove bounce. Note a
`close()` with a `beforeClose` guard **always** enters `closing` asynchronously (guard result is awaited
in a microtask even if it returns `true` synchronously) — documented design trade-off (README), so the
getter can read `true` for one tick.
Multi-entry pack (`vite.config.ts` `entry: { index, vue }`) emits `dist/esm/{index,vue}.{mjs,d.mts}`.
Vue tests use `effectScope()` (for `onScopeDispose`) and `app.runWithContext()` (for the inject path)
— no DOM/`@vue/test-utils` needed.

## The core problem it solves

Apps need to show dialogs/modals/toasts **one at a time, in order**, with per-overlay rules
(route/login conditions, "once per day", delays) and occasional queue-jumping (priority /
replace / overlap). Doing this ad-hoc per feature is error-prone. This package centralizes the
*scheduling authority* while leaving *rendering* entirely to the host — so it works with React,
Vue (both function-style and template+ref), or anything, via `subscribe` + `getSnapshot` + `get`.

## Architecture map (`src/index.ts` + `src/cooldown.ts`)

- **Factory, not singleton** — `createLayerman(opts)` → `LayermanImpl`. Enables test
  isolation and multiple managers. `await manager.ready()` awaits cooldown hydrate before use.
- **Slots = independent serial queues** — `queues: Map<slot, Entry[]>`, `serial: Map<slot, Entry>`
  (0..1 occupant per slot: resolving/open/closing). `overlapping: Entry[]` is a global stack that
  bypasses the serial rule. Default slot is `""`.
- **`byId: Map<id, Entry>`** — the single source of truth for lookup; `id` is unique. `open()`'s
  `id` is optional — omitted ⇒ `genId()` mints `__layerman_auto_${n}` and the entry skips the
  duplicate/existing-id dance entirely (guaranteed fresh), going straight into the normal
  enqueue/schedule path.
- **Scheduler (`schedule(slot)`)** — `schedule` only marks the slot dirty; `batch` runs `scheduleNow`
  at the outermost batch end. Never locks a candidate during the wait: on any trigger it
  cancels the pending open-timer, re-picks `front` (sort `cmpEntry`: replace-jumped band first,
  then priority desc, then FIFO `seq`) among *eligible* entries, computes
  `remaining = (front.delay ?? gap) - (now - lastClosedAt[slot] ?? startedAt)`, opens if `<=0`
  else sets a timer. Cold start uses `startedAt`.
- **Eligibility** — one entry point `evaluate(entry, {conditionsOnly?, ignoreConditions?}) → 'pass'|'wait'`
  (no `drop`): `conditionsPass` first (`when(ctx)` is sole authority if present; else `route` AND
  `requiresAuth` read reserved context keys `ctx.route`/`ctx.auth`), then `CooldownStore.canShow` unless
  `exemptCooldown`. Same-id reopen takeover deliberately bypasses it.
- **CooldownStore** — hydrate-once-then-sync. `session` counts in memory; `total`/`day`/`hour`/
  `minute` counts + `minGap` `lastShownAt` persist as one JSON blob under `storageKey`.
  `day/hour/minute` buckets are **local calendar-aligned**; `minGap` is rolling. All configured
  fields AND together; counts increment on real open (write-through + cross-tab broadcast).
  `hydrate()`'s `storage.get()` is async; its records go through the same per-record `mergeRecord`
  as broadcasts (validated, merged — NOT "fill only missing ids" any more). `flush()` is a no-op until
  `hydrated` (only marks dirty; hydrate's `finally` flushes) and writes are **serial** (one in flight, dirty
  re-flush after it ends, failures swallowed) — so an early `open` can't overwrite the disk table with a
  table that lacks the other ids. `mergeRecord`: total/lastShownAt = max; per bucket field same bucket ⇒ max
  count, different bucket ⇒ the side with the newer `lastShownAt` (no lexical-order assumption; clock
  rollback/DST safe). `validateRecord` drops a single bad record (non-negative integer counts, finite
  `lastShownAt`, real-calendar bucket labels). Persisted object is `Object.create(null)` (`__proto__` id
  safe). `mergeRemote` only updates memory (no immediate write).
- **Backend-driven `resolve`** — an overlay with `resolve(signal)` enters `resolving` (occupies
  the slot) only after it's front AND passes sync conditions/cooldown; `null` ⇒ skip. **Not
  interrupted by higher-priority arrivals** (committed once resolving); explicit `replace` aborts
  it via the `AbortController`.
- **ResultBroker** — `open()` returns `{ id, result }`. `result` is a Promise the host settles via
  `resolve(id, v)`/`reject(id, e)`. Passive end (`remove`/`clear`/replace/destroy/capped/…) settles it with
  `{ dismissed: true, reason }` (`DismissReason`: removed/closed/cleared/replaced/unmet/capped/destroyed/empty;
  `closed` only for a shown entry that went through `close()` into `closing` and was then removed — `close()` on a
  pending/resolving entry is a no-op). Value type is `unknown` — the manager never interprets it.
- **Two-phase close** — `close(id)` → `phase='closing'` (host plays exit animation; still occupies
  slot) → `remove(id)` frees + advances. `autoRemove` (`true`=300ms | number | false) auto-fires
  `remove` after `close` unless `false`. A per-overlay **`beforeClose?: () => boolean|Promise<boolean>`**
  guards `close`: resolves `false` ⇒ cancel (via `doClose` only after the guard passes; guard errors
  also cancel). `beforeClose` does NOT gate `remove`/`clear`/auto-dismiss (those are forced). A
  `closePending` flag on the entry blocks a second `close()` from re-invoking an async guard while
  the first invocation's promise is still pending (e.g. double-click) — the guard may have side
  effects (confirm dialog, analytics) and must fire at most once per close request.
- **`update(id, patch)`** — shallow-merges `patch` into an entry's `data`; notifies only when the entry is
  open/closing **and** some patched value differs (`Object.is`) from the current one (pending: silent;
  resolving: patch also replayed onto the resolved data); no queue change (unlike `replace`).
- **`clear(select?)`** — `select` is `(ctx, records:{id,data,slot,phase,active}[]) => string[]|void`;
  returns ids to remove (via `remove`), non-array/void ⇒ all. Object form `clear({closeActive})` is the
  legacy queue-clear. This replaces a dedicated `group` field (filter on `data.group` in the selector).
- **`dismissWhenUnmet` (default true)** — in `setContext`, any shown (open/closing) overlay whose
  conditions no longer pass is auto-`remove`d (advancing the queue). Pending/queued items are NEVER
  deleted on condition-false — they stay and re-qualify later.
- **`stackIndex`/`isTopmost`** — `emitNow()` sorts actives by `enteredSeq` (real entry order, set in
  `markShown`; independent of `instanceKey`, which stays the render key) and stamps each with its
  layer index + topmost flag, so the (headless) host computes z-index / `pointer-events` for stacked
  overlaps; the core sets no z-index.
- **Store/subscribe** — `emit()` only sets `needEmit`; `emitNow()` (called by `batch` once effects are
  drained) rebuilds a frozen-ish `OverlayState { active, queued }`, caches the reference (stable until next
  change), and notifies. Each subscriber ends up with the final snapshot (`=== getSnapshot()`): if a subscriber makes a
  visible change (`needEmit`) the round restarts with a fresh snapshot for everyone; if it only dirtied slots/queued
  effects, those drain and the *same* snapshot continues to the remaining subscribers (`pendingListeners`) — no
  subscriber is skipped or sees one snapshot twice. Re-notification is capped by `MAX_NOTIFY_ROUNDS = 100`
  (100 notification rounds **in total** per outermost call, first round included; past it: stop re-notifying, drain the
  rest, deliver the latest snapshot (same reference) to every subscriber one final time — mutations made during
  that final delivery are silent — and report once via `logger`, else `console.warn`, regardless of `debug`) — subscriber mutations must converge, and a legitimate cascade
  needing more than 100 rounds is truncated. A subscriber added mid-notification misses that round's snapshot (adapters re-read on subscribe). `getSnapshot`/`get(id)` are
  side-effect-free and safe pre-hydrate; `getServerSnapshot()` returns a constant empty state.
- **Cross-tab** — optional `BroadcastChannel` (`${storageKey}:sync`) syncs cooldown counts only (no
  `storage` event, no storage lib); on receive it `mergeRemote`s and re-schedules all slots. Default
  `crossTab` = `typeof BroadcastChannel !== 'undefined' && typeof window !== 'undefined'` (browser on,
  Node/SSR off); the channel gets `unref?.()`. Eventually consistent — **no strict global quota**; with
  crossTab off, last tab to write overwrites the whole table.
- **Logging** — `debug` + `logger` emit `[layerman]:${id}:${state}` where state ∈
  {pending, resolving, open, closing, closed}. These 5 are internal lifecycle transitions; the
  **public `OverlayInstance.phase` is only `open|closing`** (rendering contract stays minimal).

## Non-obvious invariants — do NOT break these

1. **No `enum`, no parameter properties.** Repo sets `erasableSyntaxOnly: true`. `OverlayPhase`/
   `LOG_STATE` are `as const` objects + matching type alias. `CooldownStore` declares fields then
   assigns in the constructor body — never `constructor(private x)`.
2. **`remove(id)` ALWAYS re-schedules the slot** — not only when it freed the serial slot. Removing
   a queued (pending) front must re-pick and clear the stale open-timer, or the next candidate
   never advances. (This was a real bug the "delay overrides gap" test caught.)
3. **（已按实现修订）`emit()` only sets `needEmit`; notification is coalesced at batch end.** `emitNow()` at
   drain notifies once per round and every subscriber ends up with the final snapshot. `emit()` is called
   for active changes, and `open()` calls `emit()` unconditionally at the end of the queue path (the entry
   is still `pending` until the batch drains — it only sets `needEmit`, so it is cheap), so `queued` stays
   observable — don't remove it. No-change ops don't notify: `clear()` that removed nothing,
   `update()` on open/closing with all patch values `Object.is`-equal (pending: never).
4. **Displaced-vs-discarded on replace/duplicate:** `replace` displacing an active overlay
   re-queues it (`displace`, `exemptCooldown = (was 'open')`). A **duplicate `open` of an already-
   active id** DISCARDS the old instance (`discardActive`, no re-queue, old result → dismissed) and
   the new one takes over with a fresh `instanceKey`. A duplicate of a *queued* id overwrites that
   queue entry. There is no `update` flag. The self-update branch also sets `exemptCooldown = true`
   on the new entry — a same-id reopen while already active is "one continuous display" being
   refreshed, not a second real showing, so it must not add to `session`/`total`/`day`/`hour`/
   `minute` counts (N self-updates must not exhaust a `cooldown.total` limit meant for N real shows).
   If the self-update also carries `overlap: true` and stays in the *same* slot, `discardActive`
   frees that serial slot but the entry itself never re-occupies it (overlap entries don't touch
   `serial`) — the `overlap` branch must call `schedule(slot)` before returning, or whatever was
   queued behind the old occupant stalls until an unrelated event happens to touch that slot.
5. **`affix` only blocks `replace`.** A `replace` against an affixed active overlay is redirected
   into the queue as a **replace-jumped** entry (ranks ahead of ALL normal entries regardless of
   their priority; among jumped entries priority decides). Explicit `close`/`remove`/`clear` and
   same-id self-update ignore `affix`.
5b. **`replace` only displaces the current when the replacer is itself eligible** (conditions +
   cooldown pass at `open` time). An ineligible `replace` must NOT kick out the active overlay — it
   degrades to a normal queued entry and waits. Otherwise you'd close the current one and show
   nothing (blink / double onClose·onShow). Same guard applies to the affix-jump path.
5c. **（已按实现修订）`pauseAll` is a FULL freeze, not just queue-pause.** While paused, nothing new becomes
   active: serial scheduling is frozen, `replace` won't displace (falls to enqueue), and `overlap`
   opens are held in `pendingOverlaps` (NOT shown immediately). `resumeAll` hands out `pendingOverlaps`
   (openOverlap if still eligible), then cached resolves, then thaws and re-schedules — one effect at a time,
   re-checking `paused` each step (a hook calling `pauseAll` halts the rest). Explicit `close`/`remove`
   still work while paused. `clear` also dismisses `pendingOverlaps`. (This was a deliberate change:
   users expect "pause ⇒ nothing pops".) `resolve` only runs in the serial path, so an `overlap`
   overlay must NOT carry `resolve` — it opens immediately without resolving.
5d. **`pause(id)`/`pauseAll()` freeze BOTH timers on an entry** — `freezeDuration`/`thawDuration`
   (the `duration` auto-close countdown) AND `freezeAutoRemove`/`thawAutoRemove` (the post-`close()`
   auto-`remove` countdown). Pausing a `closing`-phase entry must stop its `autoRemoveTimer` too, or
   it gets yanked out of `active` mid-pause — "paused" has to mean nothing changes, not just
   "duration frozen".
6. **（已按实现修订）`resolve` is committed once entered.** The only landing guard is `land`'s
   `ac.signal.aborted || entry.resolveState.abort !== ac` (`onResolved` itself no longer re-checks slot/phase).
   That is sufficient because `abort` exists only while the entry is `resolving` and owns `serial[slot]`, and
   every path that leaves that state clears it (`detach` / `doOpen` / `finishResolve`'s wait branch); a displaced
   entry drops the late result (it was re-queued and will resolve again). If you add a path that changes phase
   or slot ownership, clear `abort` too (checkers e/c/d). Higher-priority normal arrivals must NOT preempt it —
   only `replace` does.
7. **Cooldown expiry is not a wake trigger.** An item blocked solely by `minGap`/`day`/etc. won't
   auto-appear when the window passes; it re-evaluates on the next trigger (`open`/`remove`/`clear`/
   `setContext`/gap-timer/`resume`). Tests nudge with `setContext({})` after advancing the clock.
8. **`now()` and `storage` are injectable** for testing; `day/hour/minute` buckets use local time
   via `Date`. Tests use `vi.useFakeTimers()` + `vi.setSystemTime()` so default `Date.now` and
   `setTimeout` are both mocked.

### Added by the final-review refactor (invariants 9+) — read with 1–8

These are additions/refinements, not replacements: where they conflict with the *wording* of 1–8
(e.g. 3's "emit fires…", 5c's "`resumeAll` flushes `pendingOverlaps`"), the code follows 9+ and the
*intent* of 1–8 still holds.

9. **(D1) Condition predicates must not mutate the manager.** `conditionsPass` wraps evaluation in
   `judging++/--`; every public *mutating* method starts with `assertMutable()` which throws
   `[layerman] 条件求值期间禁止修改管理器` **before touching state**. `conditionsPass` catches it ⇒ the
   condition is treated as *not met* (logged under `debug`). Reads (`getSnapshot/get/subscribe/ready`) are
   allowed; hooks/subscribers may call the manager (handled by invariant 10). Never move `assertMutable`
   after a state change. *Source: final-plan §4 D1(a), A1.*
10. **batch / effects: commit state first, run host callbacks last.** All public mutators go through
    `batch(fn)` (`depth`, `dirtySlots`, `effects`, `needEmit`). `schedule()` only marks dirty. At depth 1
    the drain loop is: flush dirty slots → run ONE effect → (when no effects left) `emitNow()` once →
    repeat until empty. `onShow/onClose/onRemove` and `AbortController.abort()` are **pushed to `effects`**,
    never invoked mid-transition, and still run synchronously before the *outermost* public call returns (a nested call from a hook/subscriber
    joins the outer batch: its hooks run after the current callback returns, and `getSnapshot/get` right after it still show the old state). `discardActive`
    registers the old entry's hooks only after the new entry is in `byId`. ⇒ one public op notifies at most
    once (follow-up round only if hooks/subscribers re-mutate); tests asserting notification *counts* must
    expect this. `resumeAll` hands out pending overlaps/resolves one effect at a time and re-checks
    `paused`/identity each step. *Source: final-plan §2 #3/#4/#7, A1–A4/A8.*
11. **（已按实现修订）epoch (generation).** `Entry.epoch++` on entering `resolving` (`activate`) / `open`
    (`doOpen`, `openOverlap`). `duration` timers and `beforeClose` async decisions (both the resolve and the
    reject callback) capture the epoch and bail on mismatch; the `autoRemove` timer has **no** epoch check and
    relies on `byId.get(id) === e` (a `closing` entry never re-opens and `detach()` clears its timer); `resolve`
    landing uses the `abort` identity (invariant 6), not epoch. `detach()` clears timers, `abort`, cached
    resolve data, `close.pending`. Any new timer/guard callback needs an epoch **or** identity check.
    *Source: A5/A6/A7/N4.*
12. **destroy semantics.** `destroying`/`destroyed` flags: during and after destroy, `open()` returns a
    handle whose `result` is already `{dismissed:true, reason:'destroyed'}` (nothing registered/shown/persisted); other
    mutators no-op; broadcast messages ignored. `destroy()` is idempotent and removes everything through
    `clearImpl({closeActive:true})` (each onRemove once). The final empty snapshot is emitted to subscribers
    at the end of the outer batch, THEN `subscribers.clear()` runs (in `batch`, not in `destroyImpl` — don't move it back);
    nothing is emitted afterwards. *Source: A9.*
13. **"Removed from `byId` ⇒ already settled" and "the remover owns finalize".** `removeImpl` deletes
    from `byId` first, `removeFromQueue` also strips `pendingOverlaps`, `clearImpl` calls `removeImpl` per
    id (no iteration over a live container) — so an entry is finalized (onRemove, result) exactly once.
    *Source: A2/A3/N1.*
14. **Cooldown store write discipline.** hydrate-before-flush, serial single in-flight write, per-record
    validated merge for storage *and* broadcast, `Object.create(null)` table. See Architecture map.
    *Source: B2/B5/B6/N2/F5.*
15. **`checkInvariants()` (private, read-only) is the safety net — keep it green and keep it in sync.**
    Codes a–h: (a) every `byId` entry in exactly one of `queues/serial/overlapping/pendingOverlaps`; (b)
    container members satisfy `byId.get(e.id)===e`; (c) container ⇔ phase (queue/pending=pending, serial=
    resolving|open|closing, overlap=open|closing with `overlapping`); (d) serial key = `entry.slot`; (e) timer/
    flag ⇔ phase (`durationTimer`⇒open+unpaused, `autoRemoveTimer`⇒closing+unpaused, `*Remaining`⇒paused,
    `abort`⇒resolving, `close.pending`⇒open, `hasPendingResolve`⇒resolving); (f) `openTimers` ⇒ unpaused, slot
    free, queue non-empty; (g) `snap.active` identity+order = derived from containers; (h) after destroy
    everything empty; (i) no capped entry in a waiting container (queue/`pendingOverlaps`); (j) every
    `pendingOverlaps` entry has a reason: paused or still needs hydration. It must not evaluate predicates, emit, or schedule. It is invoked from tests via a cast
    (declared with `@ts-expect-error` for unused-private, intentionally not referenced by production code).
    When you add state, extend the checker AND add a reverse-break case in `invariants.test.ts`.
    *Source: final-plan §2 #1/#10, F14.*
16. **(D3) Capped entries never linger in a queue.** An entry is *capped* when `session`/`total` is
    permanently used up (`isCapped`: not `exemptCooldown`, already hydrated). `evaluate` returns `drop` for
    it; `openImpl` (at submit), `scheduleNow`, the hydrate-complete callback, the cross-tab merge (a paused-held overlap that became capped settles
    `capped` immediately, not at `resumeAll`), `finishResolve` and
    `resumePending` all remove it via `removeImpl(id, 'capped')` — not shown, not counted, no `onShow`.
    `minGap/day/hour/minute` are time-based, *not* capped, and stay queued (invariant 7 unchanged).
    Never reintroduce "serial item waits forever on an exhausted cap". Checker code (i).
17. **(D5) Hydrate gate: held-before-hydrate is a legal state.** While the store is not hydrated, an
    entry whose cooldown has a persisted field (`total/day/hour/minute/minGap`) gets `evaluate → wait`
    (serial stays queued; overlap goes to `pendingOverlaps`, not dropped; same-id takeover does not skip it).
    When `ready()` settles (success, failure or bad data) one batch re-schedules every slot, drops capped
    held overlaps and calls `resumePending`. `session`-only / no-cooldown entries are unaffected. Do not
    "fix" a held entry as a leak; the storage `get` Promise must eventually settle. Checker code (j).
18. **Passive settle always carries a `reason`.** Every path that fulfils `result` with a dismissal goes
    through `finalizeRemoved → settleDismiss(e, reason)`; `removeImpl` defaults to `closed` (closing phase)
    or `removed`. The type keeps `reason?` optional for compatibility, but the core must never emit a
    reasonless `{dismissed:true}`. New passive paths need a `DismissReason` and a case in the reason tests.
19. **(N5) `resolve`/`reject` act only on ever-shown entries.** `resolveImpl/rejectImpl` return unless the
    entry exists, is not settled and `enteredSeq !== 0`. Queued, `resolving`-not-yet-shown and held overlap
    entries are no-ops, so `result` is never settled before the overlay was displayed.

## Dependency policy (monorepo convention)

**Sub-projects reuse the parent workspace's dependencies by default.** The example under
`example/` is a workspace member (`pnpm-workspace.yaml` globs `apps/*/example`) and pulls **every**
dep from the monorepo — `@codejoo/layerman` via `workspace:*`, and tooling/libs via
`catalog:` (`vue`, `vant`, `@vitejs/plugin-vue`, `vitest`, `@vitest/browser`,
`@vitest/browser-playwright`, `playwright`, `vite-plus`). Do NOT install a dep locally in a
sub-project unless it is genuinely sub-project-specific — and only then, and say why. Shared
versions live in the root `pnpm-workspace.yaml` catalog; add new shared deps there, not in the
sub-project. (Note `overrides.vite: catalog:` forces every member onto the vite-plus fork, so
browser testing uses the shared `@vitest/browser-playwright` stack via `vp test`, not a bespoke
standalone vite + playwright script.)

## Build & config

- Build chain is **vite-plus** (`vp` CLI): `vp pack` reads `vite.config.ts` — ESM only, browser
  platform, `es2022`, dts via tsgo, output `dist/esm/index.mjs` + `.d.mts`.
- **Zero runtime & peer deps.** DOM types (`BroadcastChannel`, `localStorage`) come from the
  `DOM` lib in `tsconfig.json`; both are feature-detected/guarded so it runs in Node/SSR too.
- Lint/format: `vp lint -c oxlint.config.ts` (type-aware) + `vp fmt -c oxfmt.config.ts`. Lint has a
  few `no-unsafe-type-assertion`/`no-floating-promises`-style **warnings** (JSON.parse, MessageEvent
  data, generic result cast, fire-and-forget storage write) — these are acceptable warnings, not
  errors. **`pnpm check` is green** (fmt OK, lint 0 errors / warnings only). The nested `example/` and
  `mocker/` sub-projects are independent packages with their own configs, so both fmt and lint ignore them
  (`ignorePatterns` in `oxfmt.config.ts` / `oxlint.config.ts`) — do not remove those entries. `oxfmt` wants LF
  (`endOfLine: "lf"`); on Windows with `core.autocrlf=true` a fresh checkout is CRLF and `oxfmt --check` will
  fail on line endings alone — run `pnpm exec vp fmt -c oxfmt.config.ts` once to normalize the working copy
  (content-neutral; git still sees LF in the index).

## Verify workflow

Acceptance = **`pnpm test` green** (vitest through `vp test`): **14 files, 862 passed, 0 failed**
(verified 2026-11-06, node + jsdom; per-file counts in the Tests list above — if a number drifts, re-run and
update both). There is no expected-fail test any more. Tests inject an in-memory
`AsyncableStorage`, set `crossTab:false` (a dedicated `crossTab:true` test drives the real global
`BroadcastChannel` and pokes `m.channel.onmessage(...)` directly to simulate a remote tab), drive
fake timers, and assert on `getSnapshot().active`/`.queued`, callbacks
(`onShow/onClose/onRemove`), and `result` promises.

```bash
cd apps/layerman
pnpm test          # vitest — the real acceptance gate (862 passed, 14 files, no expected fail)
pnpm check         # oxfmt --check + type-aware oxlint (green; on a CRLF checkout run `vp fmt` first — see above)
pnpm build         # vp pack → dist/esm
```

**Fuzz (`test/fuzz.test.ts`)**: fixed-seed, zero-dep (inline `mulberry32`); 4 ids × 2 slots, 60 steps per
seed, `SEED_COUNT = 200`. Op pool: open (queue/replace/overlap/affix/backend resolve/duration/cooldown/
sync+async `beforeClose` true/false, slow/failing hydrate, capped cooldowns), close, remove, clear (object + selector), update, setContext,
pause/resume, pauseAll/resumeAll, advance timers, resolve/reject, destroy. After every step it calls
`checkInvariants()` and asserts model invariants (result settled ≤1×, onRemove ≤1×, no hook after remove,
show/close pairing, no new active while paused, all settled after destroy, a never-shown entry is never settled by resolve/reject) plus a branch-coverage counter
test. **Re-entrancy** is an independent random source (`callbackRandom`) gated by the constant
**`ENABLE_REENTRANT_SUITE`** (currently `true`, `REENTRANT_SEED_COUNT = 200`): hooks randomly
`remove/setContext/clear/open`. Failures throw `seed=… REENTRANT=…` + the full op log — replay by setting
the seed. Don't turn the reentrant suite off to make a change pass.

**`test/regressions.test.ts` convention**: one case per final-review defect (A*/B*/N*). An **`it.fails`**
case asserts the *fixed* behaviour of a known-open defect; when the fix lands, flip it to `it` (vitest reports
an unexpected pass as failure, which is how you notice). There are currently **no** `it.fails`: N2 (D5
hydrate gate), N3 (D3 capped) and N5 (resolve/reject on never-shown entries) are implemented and run as normal
`it`. Still unimplemented (see ARCHITECTURE.md §13): D2 visible-count, D4 cooldown self-wake, business gate,
ticket, core `close()` returning `Promise<boolean>`.

**Coverage** (no new dependency; delete the generated `coverage/` afterwards):

```bash
pnpm exec vp test --coverage --coverage.include="src/**" --coverage.reporter=text
```

Coverage numbers are not recorded here (they move as tests are added); run the command above for the current figures.

There is also a runnable **Vue 3 + Vant example with a full-API browser test** at
`example/` — a **nested workspace member** (`@codejoo/layerman-example`, private) that reuses
every dep from the parent (see Dependency policy above). `pnpm --filter
@codejoo/layerman-example test` runs `vp test -c vitest.browser.config.ts` in real Chromium
(shared `@vitest/browser-playwright` + `@vitejs/plugin-vue`), ~28 cases covering every core API
(importing the built package directly) plus the Vue adapter (mounting the real Vant `App.vue`).
Build the package first (`workspace:*` resolves to `dist`). Cooldown
`day/hour/minute/total`/persistence/cross-tab need a controllable clock → covered only by the unit
suite. Ignore the "mixed vitest versions" warning — it's inherent to the vite-plus fork pairing
(same as `apps/storage`).

**Because `example/` is nested inside the package dir, the package excludes it from its own
tooling:** `vitest.config.ts` restricts `test.include` to `test/**`, and `oxfmt`/`oxlint` configs
`ignorePatterns` `**/example/**`. Don't remove those or the package's `check`/`test` will pick up the
example's `.vue`/browser test and fail.

When changing behavior, add/adjust a test and — if you touch public API — keep `README.md` (EN)
and `README.zh-CN.md` (ZH) in sync. The locked design lives in `apps/layerman/design.md`
(the original brief) plus the memory note `project_overlay_manager`.
