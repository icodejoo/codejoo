# `share`

Concurrent-request deduplication keyed by `config.key` (produced by [`key`](../key/)). Multiple policies share one core: `Promise.withResolvers` per `(key, round)`; the policy decides which HTTP attempt is allowed to settle that promise.

| Policy | Behavior |
|---|---|
| `start` (default) | Concurrent same-key requests share the **first** HTTP call's promise. Only one HTTP request is made |
| `end` | Newer call replaces older. All callers wait for the **last** HTTP attempt |
| `race` | Each caller fires its own HTTP. The **first to succeed** is broadcast to everyone (`Promise.any`-style) |
| `none` | Disabled — equivalent to not having the plugin for this request |

For automatic retries on failure, use the dedicated [`retry`](../retry/) plugin alongside `share`.

## Options

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enable` | `boolean` | `true` | Plugin kill switch |
| `policy` | `SharePolicy` | `'start'` | Default policy; per-request `config.share` overrides |
| `methods` | `string[]` | `['get', 'head']` | HTTP method allowlist (case-insensitive). Same-key POSTs/PUTs are NOT shared by default. Set to `[]` / `undefined` to disable the guard. |

```ts
import sharePlugin from 'http-plugins/plugins/share';

api.use(buildKey({ fastMode: true }));   // key producer
api.use(sharePlugin({ policy: 'start' }));     // share consumer (install AFTER buildKey)

api.get('/api', { share: false });             // disable for this request
api.get('/api', { share: 'race' });            // policy override
api.get('/api', { share: { policy: 'end' } }); // object form
api.get('/api', { share: () => isCritical() ? 'race' : 'start' });
```

## Implementation notes

- **Adapter-level**, not interceptor-level — install order matters: install `key` (request interceptor) first so `config.key` is set before `share`'s adapter sees the request.
- The shared promise is removed from the map once settled, so the next round of concurrent calls gets a fresh entry.
- Without `config.key` (e.g. `key` not installed or skipped this request) the plugin **falls through to the original adapter** without deduplication — never deadlocks, never silently drops the request.
