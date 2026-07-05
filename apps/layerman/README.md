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
# optional Vue 3 adapter is bundled under the /vue subpath (vue is an optional peer)
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

Key `open` options: `slot`, `priority`, `delay`, `duration`, `overlap`, `replace`, `affix`, `route`,
`requiresAuth`, `when(ctx)`, `dismissWhenUnmet`, `cooldown`, `resolve(signal)`, `beforeClose`,
`onShow/onClose/onRemove`. Push context for conditions with `om.setContext({ route, auth, ... })`.
See the source types for the full surface.

More manager methods:

- **`beforeClose?: () => boolean | Promise<boolean>`** — per-overlay close guard; return (or resolve)
  `false` to cancel a `close()` (e.g. an unsaved-changes confirm). Any other value proceeds.
- **`dismissWhenUnmet` (default `true`)** — when a shown overlay's condition (`route`/`when`/
  `requiresAuth`) stops holding after a `setContext`, it is auto-dismissed and the next shows. Set
  `false` to keep it. (Pending/queued overlays are never deleted — they just wait.)
- **`update(id, patch)`** — merge `patch` into an active overlay's `data` in place and re-render,
  without any queue change (distinct from `replace`).
- **`clear(select?)`** — pass `(ctx, records) => id[]` to clear exactly those (records =
  `{id, data, slot, phase, active}[]`); return non-array ⇒ clear all. Or `clear({ closeActive })` for
  the classic form. (This subsumes "close all overlays of group X" via `data.group` filtering.)
- **`OverlayInstance.stackIndex` / `isTopmost`** — layer position for stacked/overlap overlays; the
  headless core sets no z-index — use these to compute z-index and `pointer-events` in your renderer.

### `overlap` vs `replace` vs the queue — and why `overlap` can "drop"

- **normal** `open`: joins the slot's serial queue; shows one-at-a-time when its turn comes **and**
  conditions/cooldown pass. If not eligible yet, it **waits** in the queue.
- **`replace`**: preempts the current active overlay of the slot (only if the replacer is itself
  eligible), shows immediately, skips `gap`; still one-at-a-time.
- **`overlap`**: bypasses the serial queue entirely and shows **stacked, immediately** — for
  unconditional urgent overlays (global error, critical alert, blocking loader). Because an overlap
  overlay is **never put in a queue**, its conditions/cooldown act as a one-shot _fire-gate_
  evaluated at `open` time: pass → show now; **fail → the request is dropped**, its `result` resolves
  `{ dismissed: true }` (no `onShow`/`onClose`). It is **"now or never"** — there is no queue to hold
  it until it becomes eligible.

So `overlap` "drops" precisely because it opted out of the queue: dropping is the only consistent
outcome for a not-queued overlay that isn't allowed to show right now. If you want **"show as soon as
it becomes eligible"**, that's what the normal queue is for — use a normal or `replace` overlay (they
wait). **Don't put deferrable conditions (`route`/`when`) on a `overlap` overlay** expecting it to be
held; cooldown on `overlap` is fine (it correctly suppresses "already shown today").

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

const ok = await om.open({
  id: "confirm-delete",
  data: { comp: ConfirmDialog, props: { message: "Delete this item?" } },
}).result;
if (ok) doDelete();
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
const claimed = await promoRef.value.open({ priority: 10, cooldown: { day: 1 } });
```

`useOverlay(id, defaults?, om?)` returns `{ instance, visible, model, phase, open, close, remove,
resolve, reject, pause, resume }` (`defaults` covered below). The manager instance is resolved as
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
  `v-model="wanted && canShow"`, or drive it with `open()` and render off **`visible`** (which
  faithfully represents the "queued but not shown yet" middle state, so it won't bounce).

Rule of thumb: use the manager's conditions/cooldown as **queue gating** (with `open()` + `visible`),
not stuffed into a `v-model` synchronous boolean.

## React / Svelte / Solid

The same adapter shape ships for other frameworks (each an optional peer dep, thin bridge over the
core — no framework in the zero-dep core itself):

- **`@codejoo/layerman/react`** — hooks via `useSyncExternalStore` (SSR-safe): `useOverlays`,
  `useOverlay(id, defaults?, om?)`, `LayermanProvider` / `useLayerman`, `useCurrentOverlay`.
- **`@codejoo/layerman/svelte`** — `svelte/store` readables (Svelte 4/5): `overlayState`,
  `overlays`, `overlay(id, defaults?, om?)`, `setLayerman` / `getLayerman`.
- **`@codejoo/layerman/solid`** — signals: `useOverlayState`, `useOverlays`,
  `useOverlay(id, defaults?, om?)`, `LayermanProvider` / `useLayerman`.

Each exposes `{ instance, visible, phase, open, close, remove, resolve, reject, pause, resume }`
(Vue additionally has the writable `model` for `v-model`). A Flutter port lives separately at
`dart-labs/layerman` (embraces Flutter's `Overlay`; `show()` returns `Future<T?>`).

## License

MIT
