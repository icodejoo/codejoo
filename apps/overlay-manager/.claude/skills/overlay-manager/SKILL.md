---
name: overlay-manager
description: >-
  Work on @codejoo/overlaymanager (apps/overlay-manager) — the framework-agnostic
  HEADLESS overlay/dialog/modal/bottom-sheet/drawer queue manager (factory
  createOverlayManager). Read BEFORE modifying src/index.ts, its tests, or the READMEs.
  Covers architecture, the non-obvious invariants tests depend on, and the verify workflow.
  Triggers on: overlay, dialog, modal, bottomsheet, drawer, queue, priority, replace,
  overlap, affix, cooldown, resolve, setContext, subscribe, headless popup manager.
---

# @codejoo/overlaymanager

`apps/overlay-manager` — a **framework-agnostic, headless** overlay queue manager. Package
`@codejoo/overlaymanager`, factory **`createOverlayManager()`**. It manages *when/which*
overlays are active — queue, priority, conditions, cooldown, backend-driven resolution — and
**touches no DOM/UI/animation whatsoever**. The host renders the `active` list; the package is
pure logic with **zero runtime deps**.

Core implementation is **one file**: `src/index.ts` (~700 lines, no sub-modules). Optional
**framework adapters** (each its own subpath + OPTIONAL peer dep, all thin reactive bridges over the
core's `subscribe`+`getSnapshot`, mirroring the same `useOverlayState`/`useOverlays`/`useOverlay(id,
defaults?, om?)` + provider + `useCurrentOverlay`/`provideCurrentOverlay` shape):
- `src/vue.ts` → `/vue` (shallowRef; adds `model` v-model bridge)
- `src/react.ts` → `/react` (`useSyncExternalStore`; Context provider; no `model`)
- `src/svelte.ts` → `/svelte` (`svelte/store` readable/derived; Svelte 4/5-safe, no runes compiler)
- `src/solid.ts` → `/solid` (`createSignal`+`onCleanup`; plain derived accessors, NOT `createMemo` —
  under node/SSR-build test `createMemo` freezes)

Tests: `test/overlay-manager.test.ts` (core), `test/{vue,react,svelte,solid}.test.ts` (adapters),
`test/types.test.ts` (type-level via `expectTypeOf`, gated by tsc since tsconfig includes `test/**`)
— vitest; `react.test.ts` uses a `/** @vitest-environment jsdom */` docblock + `@testing-library/react`,
the rest are node (svelte = store contract, solid = `createRoot`). **~91 package tests / 6 files.**
Public store/query methods (`subscribe`/`getSnapshot`/`getServerSnapshot`/`get`) are **bound in the
constructor** so consumers (e.g. React `useSyncExternalStore`) can pass them as bare refs without
losing `this`.

There is also a Flutter port at `D:\workspaces\dart-labs\overlaymanager` (separate repo) — NOT a
headless port; it embraces Flutter (`Overlay`/`OverlayEntry`, `OverlayManagerScope`), `show()` returns
`Future<T?>`. See its own memory note.

## Vue adapter (`src/vue.ts`)

Pure bridge, no components. `useOverlayState(om?)` wraps `subscribe`+`getSnapshot` in a
`shallowRef` (the snapshot's stable reference means assignment triggers reactivity), auto-unsub via
`onScopeDispose`. `useOverlays(om?)` → reactive `active`/`queued`. `useOverlay(id, defaults?, om?)` → per-id
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
else it `inject`s the one provided by `createOverlayManagerPlugin(om)` / `provideOverlayManager(om)`.

**`model` is a `WritableComputedRef<boolean>` for third-party dialogs that expose only `v-model`**
(ElDialog/Vant/AntDV): get = is-active; `set(true)` = `open()` (skipped if already active);
`set(false)` = **immediate `remove()`, NOT two-phase `close()`**. This is deliberate: our `closing`
phase keeps the instance in `active` so a **self-rendered** overlay can play its exit animation
while still mounted. A third-party dialog instead owns its visibility+animation internally and only
needs the bound boolean to flip `false`; if `set(false)` used `close()`, the getter (which counts a
`closing` instance as present) would keep the boolean `true`, so the third-party would never start
its leave animation until the 300ms auto-remove — laggy/bouncing. `remove()` flips the boolean at
once, hands the exit animation entirely to the third-party, and frees the slot immediately.
Multi-entry pack (`vite.config.ts` `entry: { index, vue }`) emits `dist/esm/{index,vue}.{mjs,d.mts}`.
Vue tests use `effectScope()` (for `onScopeDispose`) and `app.runWithContext()` (for the inject path)
— no DOM/`@vue/test-utils` needed.

## The core problem it solves

Apps need to show dialogs/modals/toasts **one at a time, in order**, with per-overlay rules
(route/login conditions, "once per day", delays) and occasional queue-jumping (priority /
replace / overlap). Doing this ad-hoc per feature is error-prone. This package centralizes the
*scheduling authority* while leaving *rendering* entirely to the host — so it works with React,
Vue (both function-style and template+ref), or anything, via `subscribe` + `getSnapshot` + `get`.

## Architecture map (all in `src/index.ts`)

- **Factory, not singleton** — `createOverlayManager(opts)` → `OverlayManagerImpl`. Enables test
  isolation and multiple managers. `await manager.ready()` awaits cooldown hydrate before use.
- **Slots = independent serial queues** — `queues: Map<slot, Entry[]>`, `serial: Map<slot, Entry>`
  (0..1 occupant per slot: resolving/open/closing). `overlapping: Entry[]` is a global stack that
  bypasses the serial rule. Default slot is `""`.
- **`byId: Map<id, Entry>`** — the single source of truth for lookup; `id` is required & unique.
- **Scheduler (`schedule(slot)`)** — never locks a candidate during the wait: on any trigger it
  cancels the pending open-timer, re-picks `front` (sort `cmpEntry`: replace-jumped band first,
  then priority desc, then FIFO `seq`) among *eligible* entries, computes
  `remaining = (front.delay ?? gap) - (now - lastClosedAt[slot] ?? startedAt)`, opens if `<=0`
  else sets a timer. Cold start uses `startedAt`.
- **Eligibility** — `conditionsPass` (`when(ctx)` is sole authority if present; else `route` AND
  `requiresAuth` read reserved context keys `ctx.route`/`ctx.auth`) + `cooldownPass`.
- **CooldownStore** — hydrate-once-then-sync. `session` counts in memory; `total`/`day`/`hour`/
  `minute` counts + `minGap` `lastShownAt` persist as one JSON blob under `storageKey`.
  `day/hour/minute` buckets are **local calendar-aligned**; `minGap` is rolling. All configured
  fields AND together; counts increment on real open (write-through + cross-tab broadcast).
- **Backend-driven `resolve`** — an overlay with `resolve(signal)` enters `resolving` (occupies
  the slot) only after it's front AND passes sync conditions/cooldown; `null` ⇒ skip. **Not
  interrupted by higher-priority arrivals** (committed once resolving); explicit `replace` aborts
  it via the `AbortController`.
- **ResultBroker** — `open()` returns `{ id, result }`. `result` is a Promise the host settles via
  `resolve(id, v)`/`reject(id, e)`. Passive close (`close`/`remove`/`clear`) settles it with the
  sentinel `{ dismissed: true }`. Value type is `unknown` — the manager never interprets it.
- **Two-phase close** — `close(id)` → `phase='closing'` (host plays exit animation; still occupies
  slot) → `remove(id)` frees + advances. `autoRemove` (`true`=300ms | number | false) auto-fires
  `remove` after `close` unless `false`. A per-overlay **`beforeClose?: () => boolean|Promise<boolean>`**
  guards `close`: resolves `false` ⇒ cancel (via `doClose` only after the guard passes; guard errors
  also cancel). `beforeClose` does NOT gate `remove`/`clear`/auto-dismiss (those are forced).
- **`update(id, patch)`** — shallow-merges `patch` into an active/pending entry's `data` and re-emits;
  no queue change (unlike `replace`).
- **`clear(select?)`** — `select` is `(ctx, records:{id,data,slot,phase,active}[]) => string[]|void`;
  returns ids to remove (via `remove`), non-array/void ⇒ all. Object form `clear({closeActive})` is the
  legacy queue-clear. This replaces a dedicated `group` field (filter on `data.group` in the selector).
- **`dismissWhenUnmet` (default true)** — in `setContext`, any shown (open/closing) overlay whose
  conditions no longer pass is auto-`remove`d (advancing the queue). Pending/queued items are NEVER
  deleted on condition-false — they stay and re-qualify later.
- **`stackIndex`/`isTopmost`** — `emit()` sorts actives by `instanceKey` and stamps each with its
  layer index + topmost flag, so the (headless) host computes z-index / `pointer-events` for stacked
  overlaps; the core sets no z-index.
- **Store/subscribe** — `emit()` rebuilds a frozen-ish `OverlayState { active, queued }`, caches
  the reference (stable until next change), and notifies. `getSnapshot`/`get(id)` are
  side-effect-free and safe pre-hydrate; `getServerSnapshot()` returns a constant empty state.
- **Cross-tab** — optional `BroadcastChannel` (`${storageKey}:sync`) syncs cooldown counts only;
  on receive it merges (max counts / latest ts) and re-schedules all slots.
- **Logging** — `debug` + `logger` emit `[overlays-manager]:${id}:${state}` where state ∈
  {pending, resolving, open, closing, closed}. These 5 are internal lifecycle transitions; the
  **public `OverlayInstance.phase` is only `open|closing`** (rendering contract stays minimal).

## Non-obvious invariants — do NOT break these

1. **No `enum`, no parameter properties.** Repo sets `erasableSyntaxOnly: true`. `OverlayPhase`/
   `LOG_STATE` are `as const` objects + matching type alias. `CooldownStore` declares fields then
   assigns in the constructor body — never `constructor(private x)`.
2. **`remove(id)` ALWAYS re-schedules the slot** — not only when it freed the serial slot. Removing
   a queued (pending) front must re-pick and clear the stale open-timer, or the next candidate
   never advances. (This was a real bug the "delay overrides gap" test caught.)
3. **`emit()` fires only on active changes; `open()` adds a conditional `emit()`** when the new
   entry stays `pending`, so `queued` stays observable. Don't remove it.
4. **Displaced-vs-discarded on replace/duplicate:** `replace` displacing an active overlay
   re-queues it (`displace`, `exemptCooldown = (was 'open')`). A **duplicate `open` of an already-
   active id** DISCARDS the old instance (`discardActive`, no re-queue, old result → dismissed) and
   the new one takes over with a fresh `instanceKey`. A duplicate of a *queued* id overwrites that
   queue entry. There is no `update` flag.
5. **`affix` only blocks `replace`.** A `replace` against an affixed active overlay is redirected
   into the queue as a **replace-jumped** entry (ranks ahead of ALL normal entries regardless of
   their priority; among jumped entries priority decides). Explicit `close`/`remove`/`clear` and
   same-id self-update ignore `affix`.
5b. **`replace` only displaces the current when the replacer is itself eligible** (conditions +
   cooldown pass at `open` time). An ineligible `replace` must NOT kick out the active overlay — it
   degrades to a normal queued entry and waits. Otherwise you'd close the current one and show
   nothing (blink / double onClose·onShow). Same guard applies to the affix-jump path.
5c. **`pauseAll` is a FULL freeze, not just queue-pause.** While paused, nothing new becomes
   active: serial scheduling is frozen, `replace` won't displace (falls to enqueue), and `overlap`
   opens are held in `pendingOverlaps` (NOT shown immediately). `resumeAll` flushes `pendingOverlaps`
   (openOverlap if still eligible), thaws durations, then re-schedules. Explicit `close`/`remove`
   still work while paused. `clear` also dismisses `pendingOverlaps`. (This was a deliberate change:
   users expect "pause ⇒ nothing pops".) `resolve` only runs in the serial path, so an `overlap`
   overlay must NOT carry `resolve` — it opens immediately without resolving.
6. **`resolve` is committed once entered.** `onResolved` guards `serial.get(slot) === entry &&
   phase === 'resolving'`; if displaced mid-flight it drops the result (the entry was re-queued and
   will resolve again). Higher-priority normal arrivals must NOT preempt it — only `replace` does.
7. **Cooldown expiry is not a wake trigger.** An item blocked solely by `minGap`/`day`/etc. won't
   auto-appear when the window passes; it re-evaluates on the next trigger (`open`/`remove`/`clear`/
   `setContext`/gap-timer/`resume`). Tests nudge with `setContext({})` after advancing the clock.
8. **`now()` and `storage` are injectable** for testing; `day/hour/minute` buckets use local time
   via `Date`. Tests use `vi.useFakeTimers()` + `vi.setSystemTime()` so default `Date.now` and
   `setTimeout` are both mocked.

## Dependency policy (monorepo convention)

**Sub-projects reuse the parent workspace's dependencies by default.** The example under
`example/` is a workspace member (`pnpm-workspace.yaml` globs `apps/*/example`) and pulls **every**
dep from the monorepo — `@codejoo/overlaymanager` via `workspace:*`, and tooling/libs via
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
  errors; `pnpm check` exits 0.

## Verify workflow

Acceptance = **`pnpm test` green** (39 tests / 2 files via vitest through `vp test`: 32 core + 7
Vue). Tests inject an in-memory `AsyncableStorage`, set `crossTab:false`, drive fake timers, and
assert on `getSnapshot().active`/`.queued`, callbacks (`onShow/onClose/onRemove`), and `result`
promises.

```bash
cd apps/overlay-manager
pnpm test          # vitest — the real acceptance gate (32 tests)
pnpm check         # oxfmt --check + type-aware oxlint (warnings OK, must be 0 errors)
pnpm build         # vp pack → dist/esm
```

There is also a runnable **Vue 3 + Vant example with a full-API browser test** at
`example/` — a **nested workspace member** (`@codejoo/overlaymanager-example`, private) that reuses
every dep from the parent (see Dependency policy above). `pnpm --filter
@codejoo/overlaymanager-example test` runs `vp test -c vitest.browser.config.ts` in real Chromium
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
and `README.zh-CN.md` (ZH) in sync. The locked design lives in `apps/overlay-manager/design.md`
(the original brief) plus the memory note `project_overlay_manager`.
