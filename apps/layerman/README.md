# @codejoo/layerman

Framework-agnostic **headless** overlay queue manager for dialogs, modals, bottom-sheets, drawers
and toasts. It owns _when/which_ overlay is active — serial one-at-a-time queue with named slots,
priority / replace / overlap / affix, per-overlay conditions and cooldown, backend-driven async
resolution, imperative promise results and two-phase close — and **renders nothing**. You render
the `active` list; the package is pure logic with **zero runtime dependencies**.

> 中文文档见 [README.zh-CN.md](./README.zh-CN.md)。

## Install

```bash
pnpm add @codejoo/layerman
# framework adapters ship as subpaths — /vue /react /svelte /solid — each framework is an optional peer
```

## Core quickstart

```ts
import { createLayerman } from "@codejoo/layerman";

const om = createLayerman({ gap: 300 });
await om.ready(); // wait for cooldown state to hydrate from storage

// subscribe (framework-agnostic); active is the list you render
const unsub = om.subscribe((state) => render(state.active));

// enqueue; returns an awaitable handle
const { id, result } = om.open({ id: "welcome", data: { text: "Hi" } });

// imperative result: your UI delivers it via resolve/reject
const answer = await om.open({ id: "confirm", data: { msg: "Delete?" } }).result;
// answer is whatever your UI passed to om.resolve("confirm", ...), or { dismissed: true }

// two-phase close: mark closing (play exit anim) then remove (advances queue)
om.close("welcome"); // → phase "closing"; autoRemove (default 300ms) then removes
```

`open` takes many options (`slot`, `priority`, `delay`, `duration`, `overlap`, `replace`, `affix`, `route`, `requiresAuth`, `when`,
`cooldown`, `resolve`, `beforeClose`, hooks…); push condition context with `om.setContext({ route, auth, ... })`. Every option,
every method and every type is documented in the [API reference](#api-reference) below.

### `overlap` vs `replace` vs the queue — and why `overlap` can "drop"

- **normal** `open`: joins the slot's serial queue; shows one-at-a-time when its turn comes **and**
  conditions/cooldown pass. If not eligible yet, it **waits** in the queue.
- **`replace`**: preempts the current active overlay of the slot (only if the replacer is itself
  eligible), shows immediately, skips `gap`; still one-at-a-time.
- **`overlap`**: bypasses the serial queue entirely and shows **stacked, immediately** — for
  unconditional urgent overlays (global error, critical alert, blocking loader). Because an overlap
  overlay is **never put in a queue**, its conditions/cooldown act as a one-shot _fire-gate_
  evaluated at `open` time: pass → show now; **fail → the request is dropped**, its `result` resolves
  `{ dismissed: true, reason: 'unmet' }` (no `onShow`/`onClose`). It is **"now or never"** — there is no queue to hold
  it until it becomes eligible.

So `overlap` "drops" precisely because it opted out of the queue: dropping is the only consistent
outcome for a not-queued overlay that isn't allowed to show right now. If you want **"show as soon as
it becomes eligible"**, that's what the normal queue is for — use a normal or `replace` overlay (they
wait). **Don't put deferrable conditions (`route`/`when`) on a `overlap` overlay** expecting it to be
held; cooldown on `overlap` is fine (it correctly suppresses "already shown today").

## Without a framework (vanilla JS)

The core needs no Vue / React / anything: `subscribe` hands you the latest state and you render
`state.active` yourself. The package decides _which overlay is active and in which phase_; you decide
how it looks.

```js
import { createLayerman } from "@codejoo/layerman";

const om = createLayerman({ gap: 200 });
await om.ready();

const root = document.getElementById("overlay-root");
const nodes = new Map(); // instanceKey → DOM node

function render(state) {
  const alive = new Set();
  for (const inst of state.active) {
    alive.add(inst.instanceKey); // render key: a same-id reopen gets a new key → remounts
    let el = nodes.get(inst.instanceKey);
    if (!el) {
      el = document.createElement("div");
      el.className = "mask";
      el.innerHTML = `<p>${inst.data.text}</p><button>OK</button>`;
      el.querySelector("button").onclick = () => {
        om.resolve(inst.id, true); // deliver the result (does not close)
        om.close(inst.id); // → phase "closing"; auto-removed after 300ms
      };
      nodes.set(inst.instanceKey, el);
      root.append(el);
    }
    el.dataset.phase = inst.phase; // "open" | "closing" — drive your exit CSS from it
    el.style.zIndex = String(1000 + inst.stackIndex); // headless: you compute z-index
    el.style.pointerEvents = inst.isTopmost ? "auto" : "none";
  }
  for (const [key, el] of nodes) {
    if (!alive.has(key)) {
      el.remove();
      nodes.delete(key);
    }
  }
}

om.subscribe(render, { immediate: true }); // immediate: render once with the current snapshot

const ok = await om.open({ id: "confirm", data: { text: "Delete?" } }).result;
```

A complete runnable page (toast, priority queue, `overlap`, `replace`, route condition, pause, clear)
is in [`example/vanilla/`](./example/vanilla) — `pnpm --filter @codejoo/layerman-example dev`, then open
`/vanilla/index.html`.

## API reference

Everything exported from `@codejoo/layerman`: the factory `createLayerman`, the runtime constants
`DismissReason` / `OverlayPhase`, and the types below. Framework adapters are covered at the end.

```ts
import {
  createLayerman, // factory
  DismissReason,
  OverlayPhase, // runtime constants
  type Layerman,
  type LayermanOptions,
  type OverlayConfig,
  type OverlayHandle,
  type OverlayInstance,
  type OverlayState,
  type OverlayRecord,
  type OverlayContext,
  type ClearSelector,
  type DismissResult,
  type Cooldown,
  type Duration,
  type AsyncableStorage,
} from "@codejoo/layerman";
```

### `createLayerman(options?)`

Returns an independent manager (a factory, **not** a singleton — create one per app, or one per test).

| Option       | Type                        | Default                                     | Meaning                                                                                                      |
| ------------ | --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `gap`        | `number`                    | `0`                                         | Global ms between one overlay ending and the next of the **same slot** starting. A per-overlay `delay` wins. |
| `autoRemove` | `boolean \| number`         | `true`                                      | After `close()`, auto-`remove()`: `true` = 300 ms, a number = that many ms, `false` = you call `remove`.     |
| `storage`    | `AsyncableStorage`          | `localStorage`, else in-memory              | Where persisted cooldown state lives. `get` / `set` may be sync or async.                                    |
| `storageKey` | `string`                    | `"layerman:v1"`                             | Storage key; the cross-tab channel is named `${storageKey}:sync`.                                            |
| `now`        | `() => number`              | `Date.now`                                  | Clock — inject a fake in tests.                                                                              |
| `debug`      | `boolean`                   | `false`                                     | Log lifecycle transitions as `[layerman]:<id>:<pending\|resolving\|open\|closing\|closed>`.                  |
| `logger`     | `(message: string) => void` | `console.log`                               | Where `debug` lines go. A throwing logger is swallowed.                                                      |
| `crossTab`   | `boolean`                   | on if `window` and `BroadcastChannel` exist | Sync cooldown counts between tabs. Off in Node / SSR / Workers.                                              |

```ts
const om = createLayerman({
  gap: 300,
  autoRemove: 200,
  storageKey: "myapp:overlays",
  debug: true,
  logger: (m) => analytics.debug(m),
});
await om.ready();
```

**Custom storage** (React Native `AsyncStorage`, an IndexedDB wrapper, a server-side session store…):

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const om = createLayerman({
  storage: {
    get: (key) => AsyncStorage.getItem(key), // string | null, sync or Promise
    set: (key, value) => AsyncStorage.setItem(key, value),
  },
});
await om.ready(); // hydration is async → wait for it (see the Cooldown notes)
```

### `OverlayConfig` — the argument of `open`

All fields are optional.

| Field              | Type                                              | Default           | Meaning                                                                                                                                        |
| ------------------ | ------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | `string`                                          | auto              | Unique key. Omitted → a fresh `__layerman_auto_n` id is minted (never collides, skips the same-id rules). Also the cooldown-persistence key.   |
| `data`             | `TData`                                           | —                 | Opaque payload for your renderer; surfaces as `instance.data`.                                                                                 |
| `slot`             | `string`                                          | `""`              | Named serial queue. Each slot shows **one** overlay at a time, independent of other slots.                                                     |
| `priority`         | `number`                                          | `0`               | Higher shows first among waiting entries; ties are FIFO.                                                                                       |
| `delay`            | `number` (ms)                                     | global `gap`      | Wait this long (since the slot last freed) before showing. Overrides `gap`.                                                                    |
| `duration`         | `number` (ms)                                     | none (persistent) | Auto-`close()` this long after it is shown (the `beforeClose` guard still applies).                                                            |
| `autoRemove`       | `boolean \| number`                               | global            | Per-overlay override of the post-`close` auto-remove.                                                                                          |
| `overlap`          | `boolean`                                         | `false`           | Bypass the serial queue: show **stacked, immediately** (see [overlap vs replace](#overlap-vs-replace-vs-the-queue--and-why-overlap-can-drop)). |
| `replace`          | `boolean`                                         | `false`           | Preempt the slot's current overlay (it goes back to the queue), skipping `gap`.                                                                |
| `affix`            | `boolean`                                         | `false`           | Cannot be displaced by `replace` (a replacer queues ahead of everyone instead). Explicit `close` / `remove` / `clear` still work.              |
| `route`            | `string \| string[] \| RegExp`                    | —                 | Condition sugar: show only while `context.route` matches (string = equal, array = includes, RegExp = test).                                    |
| `requiresAuth`     | `boolean`                                         | —                 | Condition sugar: `true` = only when `context.auth` is truthy, `false` = only when falsy.                                                       |
| `when`             | `(ctx: OverlayContext) => boolean`                | —                 | Custom predicate. **Wins over** `route` / `requiresAuth` when present. Must not mutate the manager; a throw means "not met".                   |
| `dismissWhenUnmet` | `boolean`                                         | `true`            | If the conditions stop holding after a `setContext` while it is shown, auto-remove it (`reason: "unmet"`).                                     |
| `cooldown`         | `Cooldown`                                        | —                 | Frequency limits, see [Cooldown & Duration](#cooldown--duration).                                                                              |
| `resolve`          | `(signal: AbortSignal) => Promise<TData \| null>` | —                 | Fetch the payload when it is its turn; `null` / `undefined` / a throw ⇒ skipped with `reason: "empty"`. Serial only (not with `overlap`).      |
| `beforeClose`      | `() => boolean \| Promise<boolean>`               | —                 | Close guard: return / resolve `false` (or throw) to cancel a `close()`. Does **not** guard `remove` / `clear` / auto-dismiss.                  |
| `onShow`           | `() => void`                                      | —                 | Called when the overlay becomes visible (phase `open`).                                                                                        |
| `onClose`          | `() => void`                                      | —                 | Called when it enters `closing`.                                                                                                               |
| `onRemove`         | `() => void`                                      | —                 | Called once when it is removed for any reason, shown or not.                                                                                   |

Reserved context keys: `route` and `auth` (read by the `route` / `requiresAuth` sugar). Any other key is
free for your own `when(ctx)` predicates.

### Cooldown & Duration

`cooldown` limits how often one `id` may show. Every field you set must pass (**AND**), and counts
increment when the overlay really opens.

| Field     | Type       | Persisted | Meaning                                                           |
| --------- | ---------- | --------- | ----------------------------------------------------------------- |
| `session` | `number`   | no        | At most N shows in this page session (memory only).               |
| `total`   | `number`   | yes       | At most N shows ever.                                             |
| `day`     | `number`   | yes       | At most N per **local calendar day**.                             |
| `hour`    | `number`   | yes       | At most N per local calendar hour.                                |
| `minute`  | `number`   | yes       | At most N per local calendar minute.                              |
| `minGap`  | `Duration` | yes       | Minimum time since the last show (rolling, not calendar-aligned). |

`Duration` = `{ days?, hours?, minutes?, seconds? }`, summed: `{ hours: 1, minutes: 30 }` = 90 min.

```ts
om.open({ id: "promo", cooldown: { day: 1 } }); // once per day
om.open({ id: "rate-us", cooldown: { total: 3, minGap: { days: 7 } } }); // ≤3 ever, ≥7 days apart
om.open({ id: "tip", cooldown: { session: 1 } }); // once per page load
```

`session` / `total` running out is permanent → the entry settles `{ dismissed: true, reason: "capped" }`
immediately instead of queuing forever. `day` / `hour` / `minute` / `minGap` recover by themselves, so the
entry just waits (cooldown expiry does not wake the scheduler — see
[Cooldown: persistence, cross-tab and waking](#cooldown-persistence-cross-tab-and-waking)).

### Manager methods

| Method                                     | Purpose                                                     |
| ------------------------------------------ | ----------------------------------------------------------- |
| `open(config)`                             | Enqueue / show an overlay; returns `{ id, result }`.        |
| `resolve(id, value)` / `reject(id, error)` | Deliver a success value / an error to `result`.             |
| `update(id, patch)`                        | Patch a shown overlay's `data` in place.                    |
| `close(id)`                                | Start the exit phase (`closing`), guarded by `beforeClose`. |
| `remove(id)`                               | Remove entirely and advance the queue.                      |
| `clear(select?)`                           | Remove many at once.                                        |
| `pauseAll()` / `resumeAll()`               | Freeze / thaw the whole manager.                            |
| `pause(id)` / `resume(id)`                 | Freeze / thaw one overlay's timers.                         |
| `setContext(partial)`                      | Push condition context and re-evaluate.                     |
| `subscribe(listener, options?)`            | Observe state changes.                                      |
| `getSnapshot()` / `getServerSnapshot()`    | Read state synchronously.                                   |
| `get(id)`                                  | Look up one active instance.                                |
| `ready()`                                  | Wait for cooldown hydration.                                |
| `destroy()`                                | Tear everything down.                                       |

`subscribe`, `getSnapshot`, `getServerSnapshot` and `get` are bound to the instance, so you can pass them
as bare references (e.g. to React's `useSyncExternalStore`).

#### `open(config)`

```ts
open<TData = unknown, TResult = unknown>(config: OverlayConfig<TData>): OverlayHandle<TResult>
// OverlayHandle<TResult> = { id: string; result: Promise<TResult | DismissResult> }
```

Registers an overlay and returns at once; it shows when its turn comes **and** its conditions / cooldown
pass. `result` settles exactly once — with the value your UI passes to `resolve` / `reject`, or, for any
passive end, with `{ dismissed: true, reason }`.

```ts
// 1. fire and forget
om.open({ id: "welcome", data: { text: "Hi" } });

// 2. await a user decision (type the result; only `=== true` counts as confirmed)
const ok = await om.open<{ msg: string }, boolean>({ id: "del", data: { msg: "Delete?" } }).result;
if (ok === true) doDelete();

// 3. priority + slot + conditions + cooldown + hook
om.open({
  id: "vip-promo",
  slot: "banner",
  priority: 10,
  route: ["/home", /^\/shop/],
  requiresAuth: true,
  cooldown: { day: 1 },
  onShow: () => track("promo_show"),
});

// 4. backend-driven payload
om.open<Offer>({
  id: "offer",
  resolve: async (signal) => (await fetch("/api/offer", { signal })).json(), // null → skipped
});
```

Same-`id` rules: reopening an id that is **shown** discards the old instance (its `result` →
`reason: "replaced"`) and the new one takes over with a fresh `instanceKey` (no extra cooldown count);
reopening a **queued** id overwrites the queued entry. After `destroy()`, `open()` shows nothing and
returns a `result` already settled with `reason: "destroyed"`.

#### `resolve(id, value)` / `reject(id, error)`

Deliver the imperative result. They **do not close** the overlay — closing is a separate step (`close`),
so you can resolve first, play an exit animation, then remove. Ignored when the id is unknown, already
settled, or **never shown yet** (queued / still resolving): deliver from the UI once it is on screen.

```ts
om.resolve("confirm", true); // result → true
om.reject("upload", new Error("network down")); // result rejects
try {
  await om.open({ id: "upload" }).result;
} catch (e) {
  /* the Error above */
}
```

#### `update(id, patch)`

Shallow-merges `patch` into the overlay's `data` (non-object data is replaced) without touching the queue.
Subscribers are notified only if the overlay is `open` / `closing` and some value actually changed
(`Object.is`). A queued overlay updates silently; one in `resolve(signal)` keeps the patch and applies it
when the data lands.

```ts
om.open({ id: "upload", data: { percent: 0 } });
om.update("upload", { percent: 60 }); // data = { percent: 60 }; subscribers re-render
```

#### `close(id)` / `remove(id)`

Two-phase close. `close` moves a **shown** overlay (`open`) to `closing` — it stays in `active`, so your UI
can play the exit animation — then `remove` (called automatically after `autoRemove`, or by you) takes it
out and lets the next overlay in. `close` on a queued / resolving / already-closing id is a no-op.

- With `beforeClose`, the guard runs first; `false` (or a throw / rejected Promise) cancels the close. The
  decision is awaited in a microtask, so an overlay with a guard always enters `closing` asynchronously.
  Repeated `close()` calls while the guard is pending do not re-run it.
- `remove` works at any phase (queued, resolving, shown) and is **not** guarded. Its `result` settles with
  `reason: "closed"` if the overlay had reached `closing`, otherwise `"removed"`.

```ts
om.open({ id: "form", beforeClose: () => confirm("Discard changes?") });
om.close("form"); // asks first; "closing" only if the user agrees
om.remove("form"); // forced removal, no question asked

// Sync the removal with your own leave animation:
om.open({ id: "modal", autoRemove: false });
// …when the CSS transition ends:
el.addEventListener("transitionend", () => om.remove("modal"), { once: true });
```

#### `clear(select?)`

```ts
clear(arg?: ClearSelector | { closeActive?: boolean }): void
// ClearSelector = (ctx: OverlayContext, records: OverlayRecord[]) => string[] | void
// OverlayRecord = { id; data; slot; phase: "pending"|"resolving"|"open"|"closing"; active: boolean }
```

Every cleared overlay settles with `reason: "cleared"` and fires `onRemove`.

```ts
om.clear(); // drop everything still waiting (shown ones stay)
om.clear({ closeActive: true }); // drop waiting AND shown
om.clear(
  (
    ctx,
    records, // precise: remove exactly these ids
  ) => records.filter((r) => (r.data as { group?: string })?.group === "marketing").map((r) => r.id),
);
om.clear(() => {}); // a selector returning a non-array removes ALL
```

#### `pauseAll()` / `resumeAll()` / `pause(id)` / `resume(id)`

- `pauseAll()` is a **full freeze**: nothing new becomes active (serial scheduling stops, `replace` will not
  displace, `overlap` opens are held) and every `duration` / `autoRemove` countdown stops. `resumeAll()`
  releases the held overlaps and landed `resolve` results, restarts the countdowns and reschedules.
  `close` / `remove` / `clear` still work while paused. Typical use: an app-wide guided tour or a native
  permission prompt.
- `pause(id)` / `resume(id)` freeze only that overlay's own timers (`duration` and the post-`close`
  auto-remove), e.g. while the user hovers a toast.

```ts
om.open({ id: "toast", duration: 3000, overlap: true });
toastEl.onmouseenter = () => om.pause("toast");
toastEl.onmouseleave = () => om.resume("toast");

om.pauseAll(); // …tour is running…
om.resumeAll();
```

#### `setContext(partial)`

Shallow-merges `partial` into the context your conditions read, then re-evaluates: shown overlays whose
conditions no longer hold are dismissed (unless `dismissWhenUnmet: false`; `reason: "unmet"`), and waiting
overlays get another chance. It is the only way to feed context in — there is no `context` constructor
option.

```ts
om.open({ id: "checkout-tip", route: "/cart", requiresAuth: true });
om.setContext({ route: "/cart", auth: true }); // now eligible → shows
om.setContext({ route: "/home" }); // the shown one is dismissed (unmet)

om.open({ id: "beta", when: (ctx) => ctx.plan === "pro" });
om.setContext({ plan: "pro" }); // custom keys work with `when`
```

#### `subscribe(listener, options?)`

```ts
subscribe(listener: (state: OverlayState) => void, options?: { immediate?: boolean }): () => void
```

`listener` receives the new `OverlayState` after each change; the return value unsubscribes.
`immediate: true` also calls it once right away with the current snapshot. One public operation notifies at
most once, and every subscriber ends up with the latest snapshot — see
[Hooks and notifications](#hooks-and-notifications).

```ts
const unsub = om.subscribe(
  ({ active, queued }) => {
    console.log(
      "visible:",
      active.map((o) => o.id),
      "waiting:",
      queued,
    );
  },
  { immediate: true },
);
unsub();
```

#### `getSnapshot()` / `getServerSnapshot()` / `get(id)`

- `getSnapshot(): OverlayState` — the current state; the **same reference** until something changes (safe
  for `useSyncExternalStore`).
- `getServerSnapshot(): OverlayState` — a constant, frozen empty state for SSR / hydration.
- `get(id): OverlayInstance | undefined` — the **active** (open / closing) instance with that id; queued ids
  return `undefined`.

#### `ready()`

`Promise<void>` that settles once cooldown state has hydrated from storage (whether the read succeeded,
failed, or returned bad data). `await` it before the first `open` — entries whose cooldown uses a persisted
field wait for it anyway.

#### `destroy()`

Idempotent teardown: clears everything (`reason: "destroyed"`, `onRemove` for each), closes the cross-tab
channel, delivers one final empty snapshot, then drops all subscribers. Afterwards `open()` shows nothing
and every other mutator is a no-op.

### Returned and observed types

```ts
interface OverlayState {
  active: readonly OverlayInstance[]; // render these, in order
  queued: readonly string[]; // ids still waiting (observability only)
}

interface OverlayInstance<TData = unknown> {
  id: string;
  data: TData;
  slot: string;
  phase: "open" | "closing"; // the only two phases you ever see
  priority: number;
  overlapping: boolean; // came in via `overlap`
  stackIndex: number; // 0-based layer order of entry → your z-index
  isTopmost: boolean; // highest stackIndex → give the others pointer-events: none
  instanceKey: number; // bumps on every open → use as the render key
}
```

`OverlayPhase` (`{ open, closing }`) and `DismissReason` (see the [table](#dismissresult-and-dismissreason))
are exported as `as const` objects plus same-named union types, so you can both compare against them at
runtime and use them in annotations.

```ts
import { OverlayPhase } from "@codejoo/layerman";
const leaving = inst.phase === OverlayPhase.closing;
```

### Framework adapters

Every adapter is a thin bridge over `subscribe` + `getSnapshot` (optional peer dependency, own subpath).
They share one shape: the manager comes from context (or is passed as the last argument), a state bridge,
the per-id binding `useOverlay(id, defaults?, om?)`, and a "current overlay" helper for central renderers.

| Subpath                    | State                            | Per-id binding                   | Provide the manager                                                       | Current overlay                                                                           |
| -------------------------- | -------------------------------- | -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `@codejoo/layerman/vue`    | `useOverlayState`, `useOverlays` | `useOverlay(id, defaults?, om?)` | `createLayermanPlugin(om)`, `provideLayerman(om)`                         | `provideCurrentOverlay(id)` + `useCurrentOverlay(om?)`                                    |
| `@codejoo/layerman/react`  | `useOverlayState`, `useOverlays` | `useOverlay(id, defaults?, om?)` | `<LayermanProvider manager>`, `createLayermanProvider(om)`, `useLayerman` | `<CurrentOverlayProvider id>` + `useCurrentOverlay(om?)`                                  |
| `@codejoo/layerman/svelte` | `overlayState`, `overlays`       | `overlay(id, defaults?, om?)`    | `setLayerman(om)` / `getLayerman()`                                       | `provideCurrentOverlay(id)` + `currentOverlay(om?)`                                       |
| `@codejoo/layerman/solid`  | `useOverlayState`, `useOverlays` | `useOverlay(id, defaults?, om?)` | `<LayermanProvider value>`, `provideLayerman(om)`                         | `<CurrentOverlayProvider value>` / `provideCurrentOverlay(id)` + `useCurrentOverlay(om?)` |

All per-id bindings return `{ instance, visible, phase, open, close, remove, resolve, reject, pause, resume }`
(reactive values are `ComputedRef`s in Vue, plain values in React, `Readable` stores in Svelte and
accessors in Solid; Vue adds the writable `model` for `v-model`). `defaults` is the full `OverlayConfig`
minus `id`, merged into every `open()`; `open(config)` overrides it. `useOverlays()` / `overlays()` return
`{ active, queued }`. Vue's detailed idioms are in the [Vue 3](#vue-3) section; compact examples for the
others:

```tsx
// React
import { LayermanProvider, CurrentOverlayProvider, useOverlays, useOverlay, useCurrentOverlay } from "@codejoo/layerman/react";

function Host() {
  const { active } = useOverlays();
  return active.map((o) => (
    <CurrentOverlayProvider key={o.instanceKey} id={o.id}>
      <Layer />
    </CurrentOverlayProvider>
  ));
}

function Layer() {
  const { instance, resolve, close } = useCurrentOverlay<{ text: string }>(); // no id threading
  return (
    <div data-phase={instance?.phase}>
      {instance?.data.text}
      <button
        onClick={() => {
          resolve(true);
          close();
        }}
      >
        OK
      </button>
    </div>
  );
}

function PromoButton() {
  const { open, visible } = useOverlay("promo", { replace: true, cooldown: { day: 1 } });
  return (
    <button disabled={visible} onClick={() => open({ data: { text: "Offer!" } })}>
      Promo
    </button>
  );
}
// <LayermanProvider manager={om}><Host /><PromoButton /></LayermanProvider>
```

```svelte
<!-- Svelte 4 / 5: stores — prefix with $ in the template -->
<script>
  import { overlays, overlay, setLayerman } from "@codejoo/layerman/svelte";
  import { om } from "./overlay";

  setLayerman(om); // once, during component init
  const { active } = overlays();
  const promo = overlay("promo", { replace: true });
</script>

{#each $active as o (o.instanceKey)}
  <div data-phase={o.phase}>{o.data.text}</div>
{/each}
<button on:click={() => promo.open({ data: { text: "Offer!" } })}>Promo</button>
```

```tsx
// Solid: values are accessors — call them
import { LayermanProvider, useOverlays, useOverlay } from "@codejoo/layerman/solid";
import { For, Show } from "solid-js";

function Host() {
  const { active } = useOverlays();
  return <For each={active()}>{(o) => <div data-phase={o.phase}>{(o.data as { text: string }).text}</div>}</For>;
}

function PromoButton() {
  const promo = useOverlay("promo", { replace: true });
  return (
    <Show when={!promo.visible()}>
      <button onClick={() => promo.open({ data: { text: "Offer!" } })}>Promo</button>
    </Show>
  );
}
// <LayermanProvider value={om}><Host /><PromoButton /></LayermanProvider>
```

## Behavior notes

### Predicates (`when` etc.) must not mutate the manager

Inside a condition predicate (`when(ctx)`, and the `route` / `requiresAuth` evaluation) **do not call
any mutating method** (`open` / `close` / `remove` / `resolve` / `reject` / `update` / `clear` /
`setContext` / `pause*` / `resume*` / `destroy`). It throws, before touching any state, and because
conditions are evaluated defensively the throw is caught and the overlay is simply treated as **condition
not met** (with `debug: true` a log line is emitted). Read-only calls (`getSnapshot`, `get`, `subscribe`)
are fine. Lifecycle hooks (`onShow` / `onClose` / `onRemove`) and subscribers **may** call the manager.

### Hooks and notifications

State is committed first; `onShow` / `onClose` / `onRemove` then run synchronously, in order, **before
the public call returns** — never in the middle of a state transition. One public operation notifies
subscribers **at most once** (e.g. `clear()` of many overlays is a single notification); if a hook or
subscriber mutates the manager again, a follow-up round is notified after it. A throwing hook or
subscriber never breaks the manager.

"Before the public call returns" holds for the **outermost** call only. A mutation made _inside_ a hook
or subscriber joins the outer operation: its own hooks run and its snapshot applies after the current
callback returns, so `getSnapshot()` / `get()` read right after such a nested call still show the old
state. Every subscriber ends up with the latest snapshot (the same reference `getSnapshot()` returns),
even if an earlier subscriber mutated the manager, and never receives the same snapshot twice. A
subscriber added while a notification is in flight does not get that round's snapshot (read
`getSnapshot()` after subscribing, as the adapters do).

Notifications are also skipped when nothing changed: `clear()` that removes nothing, and `update()` on an
open / closing overlay whose patch values are all `Object.is`-equal to the current ones. **A mutation
made from a subscriber must converge** — guard it with a change check. A subscriber that changes the
manager on every notification (e.g. a different `update()` value each time) re-notifies until the cap of
100 notification rounds in total per outermost call (the first round counts), after which the manager stops re-notifying, delivers the latest snapshot to every subscriber one last time (mutations made during that final delivery change state silently and trigger no further notification), and reports one diagnostic line — through `logger` if configured, otherwise `console.warn`, regardless of `debug`. A cascade that legitimately needs more than 100 rounds is truncated.

### Cooldown: persistence, cross-tab and waking

- **Cross-tab is eventually consistent, not a strict global quota.** Cooldown counts are synced to other
  tabs through `BroadcastChannel`; two tabs that open the same overlay _before_ the broadcast arrives can
  both show it.
- **`crossTab` default**: on in browsers (when both `window` and `BroadcastChannel` exist), **off in
  Node / SSR**. Pass `crossTab: true` / `false` to force it.
- **With `crossTab` off (or unsupported), multiple tabs overwrite each other**: each tab writes its own
  snapshot to storage and the last writer wins, so counts recorded by another tab can be lost.
- **Cooldown expiry does NOT wake the scheduler.** An overlay blocked only by `minGap` / `day` / `hour` /
  `minute` will not pop by itself when the window passes; it is re-evaluated on the next trigger (`open`,
  `remove`, `clear`, `setContext`, a gap timer, `resume`). If you need "re-check at time T", call
  `om.setContext({})` yourself.
- **`await om.ready()` before the first `open` (recommended).** Cooldown state hydrates from storage
  asynchronously. An entry whose `cooldown` uses a persisted field (`total` / `day` / `hour` / `minute` /
  `minGap`) that is opened earlier simply **waits until hydration finishes** (a serial entry stays queued; an
  `overlap` entry is held, not dropped), then is re-scheduled immediately, whether the read succeeded,
  failed or returned bad data. So nothing is shown "blind" and nothing is under-counted. Entries with only
  `session` (or no cooldown) are unaffected. The storage `get` Promise must still eventually settle,
  otherwise hydration never finishes and gated entries wait forever.
- Invalid persisted / broadcast records are dropped individually; storage write failures are ignored.

### After `destroy()`

`destroy()` clears everything (each overlay's `result` resolves `{ dismissed: true, reason: 'destroyed' }`, `onRemove` fires),
closes the cross-tab channel, notifies subscribers **once with a final empty snapshot** (`active` empty; skipped when the manager was already empty),
then drops them. After that no further notifications are sent, and `open()` **does not show anything**: it
returns a handle whose `result` is immediately `{ dismissed: true, reason: 'destroyed' }`; every other
mutating method is a no-op.

### `DismissResult` and `DismissReason`

A passive end (anything other than your own `resolve` / `reject`) fulfils `result` with
`{ dismissed: true, reason }`. `reason` is optional in the type (so `{ dismissed: true }` still
type-checks), but the core always sets it. `DismissReason` is an `as const` object plus a same-named
union type, exported from `@codejoo/layerman`.

| `reason`    | When                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `removed`   | explicit `remove()` before the entry reached `closing`                                         |
| `closed`    | only a shown entry that went through `close()` into `closing` and was then removed             |
| `cleared`   | `clear()`, including selector clears                                                           |
| `replaced`  | same-id `open()` overwrote it, or `replace` discarded a `closing` instance                     |
| `unmet`     | `dismissWhenUnmet` on a context change; `overlap` fire-gate (condition / time cooldown) failed |
| `capped`    | `session` / `total` is permanently used up (see below)                                         |
| `destroyed` | `destroy()`, or `open()` during / after destroy                                                |
| `empty`     | the `resolve(signal)` backend returned `null` / `undefined` or threw                           |

```ts
import { DismissReason } from "@codejoo/layerman";

const r = await om.open<unknown, boolean>({ id: "promo", cooldown: { total: 1 } }).result;
if (typeof r === "object" && r !== null && "dismissed" in r) {
  switch (r.reason) {
    case DismissReason.capped: // shown enough already: never retry
    case DismissReason.destroyed: // app is shutting down
      break;
    case DismissReason.replaced: // superseded by a newer instance: ignore
      break;
    default: // removed / closed / cleared / unmet / empty
      break;
  }
} else {
  // r is the value your UI passed to om.resolve("promo", ...)
}
```

### Behavior changes (this release)

Items marked **breaking** can change what existing code observes; the rest are non-breaking.

1. **Hooks run after the commit; nested calls are deferred** (non-breaking for correct code). State is
   committed first, then `onShow` / `onClose` / `onRemove` run before the outermost public call returns. A
   mutation made inside a hook or subscriber joins the outer operation: `getSnapshot()` / `get()` right
   after the nested call still show the old state.
2. **Notifications are coalesced, with a cap** (non-breaking). One public operation notifies at most once;
   re-entrant mutations trigger follow-up rounds, at most `MAX_NOTIFY_ROUNDS` (100) rounds in total per outermost call (the first counts), after which the manager
   stops re-notifying, gives every subscriber the latest snapshot one last time (changes made during that last delivery are silent), and logs a diagnostic (via `logger`, else `console.warn`, regardless of `debug`). Make subscriber mutations converge.
3. **Predicates must not mutate the manager** (**breaking** for code that did). Calling a mutating method
   from a `when` / `route` / `requiresAuth` evaluation throws before touching state; the throw is caught and
   the entry is treated as condition-not-met.
4. **After `destroy()`** (**breaking** for code that relied on `open()` still queueing): `open()` returns at
   once with `{ dismissed: true, reason: 'destroyed' }`; subscribers receive one final empty snapshot (unless the manager was already empty), then
   are dropped.
5. **`crossTab` default** (breaking only outside browsers): on only when both `window` and
   `BroadcastChannel` exist; **off** in Node, Bun, Deno and Workers. Pass `crossTab: true` to force it.
6. **`stackIndex` follows actual entry order** (non-breaking). It reflects the order overlays really entered
   (serial slots and overlaps interleaved), not the insertion order of internal lists.
7. **`update()` on a queued entry does not notify** (non-breaking): only `open` / `closing` overlays have
   rendered data to refresh.
8. **`capped` (breaking).** A serial entry that can never show again because `session` or `total` is
   permanently used up is no longer queued forever: it settles `{ dismissed: true, reason: 'capped' }`
   immediately, and it is re-checked whenever the state can have changed: at submit time, right after hydration completes, when a `resolve(signal)` result lands, and after a cross-tab update (an `overlap` held by `pauseAll` that becomes capped settles at once, not at `resumeAll`). It is not shown and not counted. An
   `overlap` entry gets the same reason. `minGap` / `day` / `hour` / `minute` expire on their own, so they are
   **not** capped and still queue (and, as before, expiry does not wake the scheduler).
   _Migration:_ code that awaited such a `result` forever now gets it; handle `reason === 'capped'`.
9. **`DismissResult.reason`** (**breaking** only for strict equality). The runtime object changes from
   `{ dismissed: true }` to `{ dismissed: true, reason }`. Structural types are unaffected, but
   strict-equality checks (e.g. `toEqual({ dismissed: true })`) must be updated; prefer
   `'dismissed' in r` or `r.dismissed === true`.
10. **Hydration gate** (**breaking** for the old "early open may bypass" workaround). Before hydration
    finishes, entries with persisted cooldown fields wait (see "Cooldown" above) and are re-scheduled right
    after it. The earlier warning that an early `open` could bypass or under-count the limit no longer
    applies; `await ready()` is still recommended to avoid the wait.
11. **`resolve` / `reject` ignore never-shown entries** (**breaking** for code that resolved early). For an
    entry that has never been shown (queued, `resolve(signal)` still resolving, or an `overlap` held by
    pause / hydration), `resolve(id, v)` / `reject(id, e)` are no-ops and do not settle `result` early.
    Deliver results from the UI once it is actually displayed.

12. **A `update()` during `resolve(signal)` is kept** (non-breaking, bug fix). Patches applied while the
    backend request is still resolving are merged into the data that lands, instead of being overwritten.
13. **Cooldown storage is hardened** (non-breaking, bug fixes). Persisted and broadcast records are validated
    (a bad record is dropped on its own, other ids are untouched); writes are serialized and always carry the
    latest snapshot; hydration merges per id (a stale disk snapshot never rolls back fresher in-memory counts); ids such as `__proto__` persist correctly.
14. **Diagnostics never break state** (non-breaking). An exception thrown by `logger` is swallowed, and an
    exception thrown by a predicate (`when` etc.) is reported through `logger` when `debug` is on, then treated
    as "condition not met".
15. **React adapter** (non-breaking). Prefer `CurrentOverlayProvider`; the old lowercase `provideCurrentOverlay`
    export stays as a deprecated alias. The error message of `useCurrentOverlay()` without a provider now names
    the recommended component.

16. **Stale `beforeClose` decisions are ignored** (non-breaking, bug fix). If a pending guard resolves after the
    overlay was displaced and shown again, its old verdict no longer closes the new showing.
17. **Vue `model.set(false)` with a `beforeClose` guard** (non-breaking; matches what the Vue section always
    promised). Once the guard lets the close through, the instance is removed right away instead of lingering in
    `closing` until `autoRemove` fires.

## Vue 3

The `/vue` subpath is a thin reactive bridge — composables only, no components.

```ts
// overlay.ts — create once
import { createLayerman } from "@codejoo/layerman";
export const om = createLayerman();

// main.ts
import { createLayermanPlugin } from "@codejoo/layerman/vue";
await om.ready();
app.use(createLayermanPlugin(om)); // provides om app-wide (or pass om explicitly per call)
```

### Idiom A — imperative + a central `<OverlayHost>`

Overlays carry the component to render in `data`; one global host renders `active`:

```vue
<!-- OverlayHost.vue — mount once at the app root -->
<script setup lang="ts">
import type { Component } from "vue";
import { useOverlays } from "@codejoo/layerman/vue";
import { om } from "./overlay";

type OverlayData = { comp: Component; props?: Record<string, unknown> };
const { active } = useOverlays(om);
</script>

<template>
  <!-- one mask per active overlay; overlap overlays stack naturally -->
  <div v-for="o in active" :key="o.instanceKey" class="overlay-mask">
    <component :is="(o.data as OverlayData).comp" v-bind="(o.data as OverlayData).props" :data-phase="o.phase" @resolve="(v: unknown) => om.resolve(o.id, v)" @close="() => om.close(o.id)" />
  </div>
</template>

<style scoped>
.overlay-mask {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.45);
}
</style>
```

```ts
// anywhere in business logic
import { om } from "./overlay";
import ConfirmDialog from "./ConfirmDialog.vue";

// result is boolean | { dismissed: true }: a passive close (replace/clear/destroy) is truthy,
// so only an explicit `true` counts as confirmation.
const ok = await om.open<unknown, boolean>({
  id: "confirm-delete",
  data: { comp: ConfirmDialog, props: { message: "Delete this item?" } },
}).result;
if (ok === true) doDelete();
```

Inside `ConfirmDialog.vue` you emit `resolve` / `close`:

```vue
<button @click="$emit('resolve', true)">OK</button>
<button @click="$emit('resolve', false)">Cancel</button>
```

**Exit animations (two-phase).** By default `close()` auto-removes after 300ms — enough for a CSS
fade. To sync exactly with your animation, set `autoRemove: false` on the overlay and call
`om.remove(id)` when the leave transition ends:

```vue
<Transition name="pop" @after-leave="() => om.remove(o.id)">
  <component v-if="o.phase === 'open'" :is="(o.data as OverlayData).comp" ... />
</Transition>
```

### Idiom B — declarative `template + ref` via `useOverlay`

A component that already lives in the template delegates its visibility to the manager:

```vue
<script setup lang="ts">
import { useOverlay } from "@codejoo/layerman/vue";

const { visible, phase, open, resolve } = useOverlay("promo");
defineExpose({ open }); // parent can call promoRef.open()
</script>

<template>
  <div v-if="visible" class="overlay-mask" :data-phase="phase">
    <div class="card">
      <p>Special offer!</p>
      <button @click="resolve(true)">Claim</button>
    </div>
  </div>
</template>
```

```ts
// caller — same queue/priority/cooldown rules apply
// open() returns an OverlayHandle; the value arrives on its `.result` promise
const claimed = await promoRef.value.open({ priority: 10, cooldown: { day: 1 } }).result;
```

`useOverlay(id, defaults?, om?)` returns `{ instance, visible, model, phase, open, close, remove,
resolve, reject, pause, resume }` (`defaults` covered below). Every Vue composable here
(`useOverlayState`, `useOverlays`, `useOverlay`, `useCurrentOverlay`) must be called inside an
active effect scope — `setup()`, or an explicit `effectScope()` — so the subscription it creates
has somewhere to auto-unsubscribe; calling one outside a scope throws immediately rather than
leaking the subscription silently. The manager instance is resolved as
**plugin-default + explicit override**: pass `om` to any composable, or omit it to use the one from
`createLayermanPlugin` / `provideLayerman`.

For a **central renderer** (idiom A), wrap each rendered overlay in a tiny component that calls
`provideCurrentOverlay(o.id)`; the overlay component can then use `useCurrentOverlay()` to get its own
`{ close, resolve, data, ... }` with no prop drilling. When you store a component in `data` and render
it via `<component :is>`, wrap it in `markRaw(Component)` so it isn't turned into a reactive proxy.

### Third-party dialogs that only expose `v-model`

Many UI libraries (Element Plus, Vant, Ant Design Vue…) expose only `v-model` for visibility and
you can't change their API. Use the writable `model`:

```vue
<script setup lang="ts">
import { useOverlay } from "@codejoo/layerman/vue";
const { model, resolve } = useOverlay("confirm");
</script>

<template>
  <!-- third-party dialog controls its own animation; model wires both directions -->
  <ElDialog v-model="model" title="Confirm">
    <p>Delete this item?</p>
    <template #footer>
      <ElButton @click="resolve(true)">OK</ElButton>
    </template>
  </ElDialog>
</template>
```

`model` get = "is it showing"; `set(true)` = `open()`; `set(false)` = `close()` (respecting a
configured `beforeClose` guard) followed by an **immediate `remove()`** once closing has taken effect
— or a direct `remove()` if the overlay is still queued. Either way the dialog owns its exit
animation, so this avoids a v-model bounce.

**`set(false)` with a `beforeClose` guard.** `model` subscribes to the state and waits until _that same
instance_ enters `closing`, then removes it. The guard follows the core rule: only a return (or
resolved) value of `false`, a throw, or a rejected Promise cancels the close; any other value (including
`undefined`) lets it proceed. On cancel nothing is removed; if the overlay was replaced in the meantime, the pending close is
dropped and the new instance is left alone. Note that **`close()` on an overlay with `beforeClose` always
enters `closing` asynchronously** (the guard result is awaited in a microtask — even when the guard
returns `true` synchronously). This is a deliberate trade-off, so right after `model.value = false` the
getter can still read `true` for a tick when a guard is configured. Without `beforeClose` it flips at once.

**Known limitation.** `model` only observes guards configured through _this_ `useOverlay`'s `open()` /
`defaults`. If a guard set elsewhere (a direct `om.open()`, or another `useOverlay` instance) rejects a
`model = false` close, `model` cannot see the rejection and its pending listener stays behind; when the
same instance later enters `closing` for another reason (`close()`, `duration`), it is removed
immediately — skipping the exit animation. Configure guards through the same `useOverlay`'s `open()` /
`defaults`.

**Making a `v-model` overlay show immediately / jump the queue.** `v-model="model"` (or `ref = true`)
only _enqueues_ — if it gets queued behind others or a `gap`, `model`'s getter reads back `false` and
the third-party dialog bounces shut. Declare the overlay's intrinsic behavior as `useOverlay`'s
second arg `defaults` (merged into every open — `model=true`, `open()`, ref alike):

```ts
// overlap: stack over everything, bypass the serial slot → active immediately, getter true at once
const { model } = useOverlay("alert", { overlap: true });
// replace: preempt whatever occupies this slot → also immediate, still one-at-a-time
const { model: promo } = useOverlay("promo", { replace: true, priority: 10, cooldown: { day: 1 } });
```

`open(config)` still overrides `defaults` per call. Rule of thumb: a `v-model`-driven overlay should
be `overlap` or `replace` (so it becomes active synchronously); a plain queued overlay is incompatible
with `v-model`'s synchronous boolean — drive those with `open()` + render off `visible` instead.

`defaults` is **reactive-friendly** — pass a plain object, a `ref`, or a getter; it's resolved with
`toValue` on every open (read fresh each time, not continuously tracked). Function fields
(`when`/`resolve`/hooks) live inside the returned object and are never mistaken for getters:

```ts
const pri = ref(0);
const { model } = useOverlay("x", () => ({ priority: pri.value, when: () => store.vip, overlap: true }));
```

### `v-model` vs conditions — pick the right tool

A `v-model` boolean has only true/false — no "I want it but it's gated" third state. So it fits
**unconditional** overlays, not condition-gated ones. If `model = true` but a `when`/`route`/cooldown
fails: getter stays `false` (v-model bounces shut); a normal overlay then **waits queued** (opens
later when eligible), a `overlap` overlay is **dropped** (never auto-opens). Neither is intuitive.

Guidance:

- **Unconditional, must show now** (global alert/confirm): `v-model` + `defaults: { overlap: true }` (or
  `replace`). Clean.
- **Condition-gated overlay**: don't rely on `v-model`. Either compute the gate on your side and bind
  a writable computed: `const gated = computed({ get: () => wanted.value && canShow.value, set: (v) => (wanted.value = v) })`
  then `v-model="gated"`. Or drive it with `open()` and render off **`visible`** (which
  faithfully represents the "queued but not shown yet" middle state, so it won't bounce).

Rule of thumb: use the manager's conditions/cooldown as **queue gating** (with `open()` + `visible`),
not stuffed into a `v-model` synchronous boolean.

## React / Svelte / Solid

The same adapter shape ships for the other frameworks — see [Framework adapters](#framework-adapters) in the API
reference for the full table and examples. In a React central renderer wrap each active item with
**`<CurrentOverlayProvider id={o.id}>`** (capitalised, usable in JSX); `provideCurrentOverlay` is a **deprecated**
alias whose lowercase name JSX treats as a native tag. A Flutter port lives separately at `dart-labs/layerman`
(embraces Flutter's `Overlay`; `show()` returns `Future<T?>`).

## License

MIT
