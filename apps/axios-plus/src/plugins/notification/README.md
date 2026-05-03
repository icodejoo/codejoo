# `notification`

**Response-layer** unified notification plugin — turns "success / failure" into configurable toast / message / log calls, so business code no longer needs `if (res.code === '0000') { ... } else { toast(...) }` everywhere.

- Depends on `normalize`: enforced via `requirePlugin('normalize')` at install; the response interceptor reads `response.data: ApiResponse`.
- Trigger: `apiResp.success` selects the success / failure branch.
- Idempotent across retries: marks settle values with a `Symbol`, so re-entry through the plugin chain by `retry` doesn't re-fire toasts.
- Per-request opt-out: `config.notification = false`.
- User-supplied `notify`: the actual UI call (toast, console, modal, ...).

## Quick start

```ts
import notificationPlugin from 'http-plugins/plugins/notification';

api.use([
  normalizePlugin(),
  notificationPlugin({
    notify: (msg, ctx) => {
      if (ctx.success) toast.success(msg);
      else toast.error(msg);
    },
    messages: {
      onSuccess: false,           // no default success toast
      onBizError: 'Operation failed',
      onHttpError: 'Server error',
      onNetworkError: 'Network error',
      onTimeout: 'Request timed out',
    },
  }),
]);

// Business code no longer writes notifications; the plugin handles them.
const res = await ax.post('/order', { ... });

// Disable for a single request
await ax.post('/silent-action', undefined, { notification: false });
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | Master switch |
| `notify` | `(msg, ctx) => void` | none | Notification executor; `msg` is the text, `ctx` carries `ApiResponse` / `response` / `config` / decision kind |
| `messages` | object | `{}` | Default messages per scenario, see below |
| `shouldNotify` | `(ctx) => boolean \| undefined` | none | Custom "should notify" gate; `true`/`false` forces; `undefined` falls back to defaults |

### `messages` fields

| Field | Triggered when | Type |
| --- | --- | --- |
| `onSuccess` | `success === true` | `string \| TNotifyMessage \| false` |
| `onBizError` | `success === false` (business error code) | same |
| `onHttpError` | HTTP 4xx/5xx (classified by normalize) | same |
| `onNetworkError` | offline / DNS / connection refused | same |
| `onTimeout` | axios timeout | same |
| `onCancel` | user-initiated `abort` | same |

Each field may be:
- `string` — fixed message
- `false` — suppress
- `TNotifyMessage` (function) — `(ctx) => string \| false`, dynamic message

## Per-request `config.notification`

```ts
config.notification === false                 // disable for this request
config.notification === true / undefined      // use plugin-level defaults
config.notification === { onSuccess?: '...' } // field-level override
config.notification === (ctx) => ...          // MaybeFunc, dynamic
```

## Recommended `use()` order

`notification` runs as a response interceptor and **must come after `normalize`** — it reads `response.data: ApiResponse`. `retry` also runs in response interceptors; place `notification` **after** `retry` so transient retry errors don't fire toasts, only the final outcome does.

```ts
api.use([
  // ... request interceptors / adapter layer
  normalizePlugin(),
  retryPlugin(),
  notificationPlugin({ ... }),    // ← only sees the final settled value
  rethrowPlugin(),                // last: decide reject vs resolve
]);
```

## Cross-retry de-duplication

`retry` re-enters the full plugin chain on every retry, which would otherwise let `notification` fire on each attempt. The plugin tags settle values with a module-level `Symbol('http-plugins:notification:notified')` after the first notification — subsequent passes see the tag and bail. **The transient failures during retry don't fire; only the final settled value does.**
