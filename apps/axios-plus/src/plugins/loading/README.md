# `loading`

Global counter + private callback dual-mode loading plugin. `delay` filters fast requests (no flash) + `mdt` (min display time) guarantees a minimum visible duration once shown — the NN.com / Material Design "wait-then-stay" pattern.

## Three paths

| `config.loading` | Behavior |
| --- | --- |
| `false` | **Skip**: no counting, no callback |
| `true` | **Global counter**: uses the plugin-level `loading` callback; multiple requests share count + delay + mdt |
| `function` | **Private execution**: immediate `fn(true)`, `fn(false)` on settle; not in counter, not affected by delay/mdt |
| undefined | Falls back to plugin-level `default`: `true` ⇒ global, `false` (default) ⇒ skip |

## Quick start

```ts
import loadingPlugin from 'http-plugins/plugins/loading';

api.use(loadingPlugin({
  enable: true,
  default: false,                         // opt-in (recommended)
  loading: (visible) => store.setLoading(visible),
  delay: 200,                             // requests < 200ms never show spinner
  mdt: 500,                               // once shown, stay at least 500ms (no flash)
}));

api.get('/api', undefined, { loading: true });    // explicitly join global
api.get('/api');                                   // default=false ⇒ skip
api.get('/api', undefined, { loading: false });    // explicitly skip
api.get('/api', undefined, { loading: (v) => spinner.toggle(v) });  // private callback
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | Master switch; `false` means the adapter isn't installed |
| `loading` | `(visible: boolean) => any` | — | Callback for the global path; used when `config.loading` isn't a function |
| `delay` | `number` | `0` | ms to wait before firing `cb(true)` — if requests all settle within `delay`, the spinner never appears |
| `mdt` | `number` | `500` | Min Display Time — once the spinner appears, keep it visible at least `mdt` ms |
| `default` | `boolean` | `false` | Default participation when `config.loading: undefined`; `false` opt-in, `true` opt-out |

## delay + mdt timeline

```text
Request starts
  │
  ├─ 0 ~ delay ms ────────── spinner does NOT appear
  │                           ↓ settle ⇒ entire span debounced, zero flash
  │
  └─ after delay ───────────── spinner appears (cb(true))
       │
       ├─ visible < mdt ──── settle is held until mdt elapses, then cb(false)
       └─ visible ≥ mdt ──── cb(false) immediately on settle

A new request during the mdt-pending window ⇒ hide is canceled, spinner stays visible, shownAt is NOT reset
```

## Private callback usage

When `config.loading` is a function, the request goes through the **private path** — independent from the global counter:

```ts
// Per-button spinner — doesn't affect the page-wide loading
api.get('/api/refresh', undefined, {
  loading: (v) => button.classList.toggle('spinning', v),
});
```

`fn(true)` fires immediately; `fn(false)` on settle. No delay / mdt (if you need debounce, use setTimeout in your callback).

## Install order

`loading` wraps the adapter; place it after `cache` / `share` so cache hits and shared requests **don't count** as loading:

```ts
api.use([
  cachePlugin(),         // cache hits don't flash
  sharePlugin(),         // shared request counted once
  concurrencyPlugin(),
  loadingPlugin({ ... }),// only real outbound requests count
  normalizePlugin(),
]);
```

## Performance

Hot path is **zero-allocation**: skip / private / global branches are inlined directly — no intermediate objects, no helper calls. Failures still decrement via `finally`, so loading never gets stuck.
