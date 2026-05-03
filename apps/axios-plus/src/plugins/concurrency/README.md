# `concurrency`

**Adapter-layer** concurrency control — caps the in-flight HTTP request count on an axios instance; excess requests wait in a FIFO priority queue.

- Queue: bounded by `max`; settled requests (success / failure) wake the queue head automatically.
- `max <= 0` ⇒ unlimited (adapter still installed, but with a lightweight passthrough).
- Per-request priority: higher `config.priority` jumps the queue; FIFO within the same priority.
- Per-request bypass: `config.concurrency = false` skips the queue entirely.
- Abort-friendly: queued requests with `signal.aborted` are automatically removed and rejected — they never claim a future slot.
- Method allowlist: only requests whose method is in `methods` count toward concurrency.

## Quick start

```ts
import concurrencyPlugin from 'http-plugins/plugins/concurrency';

api.use(concurrencyPlugin({ max: 4 }));

// At most 4 concurrent HTTPs on this axios; the rest queue up.
ax.get('/list1');
ax.get('/list2');
// ...

// Priority request — jumps ahead of any queued requests with priority ≤ 10
ax.get('/critical', undefined, { priority: 10 });

// Force bypass (e.g., large file download on its own lane)
ax.get('/big-download', undefined, { concurrency: false });
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | Plugin master switch; `false` means the adapter is not installed at all. |
| `max` | `number` | `999` | Max concurrency; `<= 0` means unlimited (lightweight passthrough). |
| `methods` | `string[] \| '*'` | `'*'` | Method allowlist for concurrency control. `'*'` / `[]` / `['*']` all mean "no method filter". |

## Per-request config

```ts
declare module 'axios' {
  interface AxiosRequestConfig {
    concurrency?: boolean;   // false ⇒ bypass queue, send immediately
    priority?: number;       // queue priority (higher = earlier); default 0
  }
}
```

| Field | Behavior |
| --- | --- |
| `concurrency: false` | Full bypass: not counted in `active`, never queued. |
| `priority: 10` (when queue is saturated) | Inserted ahead of all queued items with priority ≤ 10. |
| `priority: 10` (when slot is free) | Takes the slot immediately; priority is irrelevant. |
| Same priority | FIFO. |
| Missing `priority` | Treated as `0`. |

## Recommended `use()` order

`concurrency` wraps the adapter, so place it **after `cache` / `mock`** (other short-circuiting adapters): cache hits and mock hits should return without consuming a concurrency slot.

```ts
api.use([
  filterPlugin(),
  keyPlugin(),
  cachePlugin(),                  // cache hits don't queue ✓
  mockPlugin(),                   // mock hits don't queue ✓
  concurrencyPlugin({ max: 4 }),  // only real network requests claim a slot
  normalizePlugin(),
  retryPlugin(),
]);
```

## Design notes

- **Priority queue**: insertions walk to the right position by descending `priority` (`O(n)`); dequeue is `shift()` (`O(1)`). `n` is typically tiny (single digits).
- **Abort listener**: `signal.addEventListener('abort', ..., { once: true })`. Cancellation removes the item from the queue; if the promise was already resolved by `release`, the redundant `reject` is a no-op.
- **Slot baton-pass on release**: instead of `active--` followed by an `active++` for the next item, the release path simply hands the slot to the queue head — avoiding any spurious dip-then-rebound on `active`.
