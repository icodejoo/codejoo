# `retry`

Failure retry, inspired by [ky](https://github.com/sindresorhus/ky).

- Default-safe: only **idempotent methods** (`get` / `put` / `head` / `delete` / `options` / `trace`) on **server-failure status codes** (`408` / `413` / `429` / `500` / `502` / `503` / `504`).
- **Exponential backoff** out of the box (`300 → 600 → 1200 …` ms), with optional jitter.
- Auto-honors **`Retry-After`**, `RateLimit-Reset`, `X-RateLimit-Retry-After`, `X-RateLimit-Reset`, `X-Rate-Limit-Reset` (delta-seconds, HTTP-date, Unix-timestamp).
- **Single decision hook** `shouldRetry(response, error)` — highest priority, can override every default rule.
- **Cancellations are never retried** — `axios.isCancel(error)` short-circuits before any other logic.
- **Counter is a countdown on `config.__retry`** — `max=3` produces sequence `3 → 2 → 1 → 0` across attempts; `-1` stays `-1` (infinite). The field survives `mergeConfig` across `axios.request` calls; no `WeakMap` needed; other plugins read `isRetry(config)` to skip themselves on retried requests.

## Quick start

```ts
import retryPlugin from 'http-plugins/plugins/retry';

api.use(retryPlugin({ max: 3 }));

api.use(retryPlugin({
  max: 5,
  methods: ['post'],         // ← merged with defaults, NOT replaced
  status: [418],             // ← merged
  delay: (n) => 100 * 2 ** n,
  delayMax: 5_000,
  jitter: true,
  retryAfterMax: 30_000,     // cap server-supplied Retry-After
  retryOnTimeout: true,
  shouldRetry: (response, error) => {
    if (response?.data?.code === 'rate_limited') return true;
    if (error?.code === 'ERR_BAD_REQUEST') return false;
  },
  beforeRetry: async ({ request, retryCount }) => {
    if (retryCount === 1) await refreshToken();
  },
}));
```

## Options

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enable` | `boolean` | `true` | Plugin-wide kill switch. `false` skips install entirely |
| `max` | `number \| boolean` | `2` | `false` / `0` = off · `true` / `undefined` = default 2 · positive int = explicit · `-1` = unlimited |
| `methods` | `string[]` | idempotent set | **Merged** with defaults. Adding `['post']` keeps GET/PUT/… intact |
| `status` | `number[]` | `[408,413,429,500,502,503,504]` | **Merged** with defaults |
| `delay` | `number \| (n) => ms` | `0.3 * 2^(n-1) * 1000` | Base backoff |
| `delayMax` | `number \| (n) => ms` | `Infinity` | Cap on the algorithmic delay |
| `retryAfterMax` | `number` | `Infinity` | Cap on `Retry-After`-supplied delay |
| `jitter` | `boolean \| (d) => ms` | `false` | `true` → `[0, delay)` random; or custom |
| `retryOnTimeout` | `boolean` | `false` | `ETIMEDOUT` / `ECONNABORTED` retry |
| `shouldRetry` | `(response, error) => boolean \| null \| void` | — | **Highest-priority decision hook**. See below |
| `beforeRetry` | `(ctx) => unknown` | — | Pre-retry hook; return `false` to cancel; throws bubble up |

### `shouldRetry(response, error)` — single decision hook

| Path | Call | Return semantics |
|---|---|---|
| `onFulfilled` (success) | `shouldRetry(response, undefined)` | **Only `true` retries** — the response is already a success. `false` / `null` / `undefined` → return as-is |
| `onRejected` HTTP error | `shouldRetry(error.response, error)` | `true` → retry · `false` → no retry · `null` / `undefined` → fall through to default rules (status / methods / etc.) |
| `onRejected` network error | `shouldRetry(undefined, error)` | Same as above |

**Priority** (highest first):

1. `axios.isCancel(error)` — always wins, never retries
2. `max === 0` — never retries
3. **Budget exhaustion** — `__retry === 0` rejects without entering the retry path
4. `shouldRetry` — `true` / `false` short-circuits; `null` / `undefined` falls through
5. Default rules: `methods` whitelist → error classification (HTTP `status`, timeout, network)
6. `Retry-After` header (when `response.status` is in the `status` list)
7. `beforeRetry` — last chance to cancel

### Per-request `config.retry`

```ts
api.get('/api', { retry: 5 });                             // override max
api.get('/api', { retry: false });                         // disable
api.post('/api', body, { retry: { methods: ['post'] } });  // opt-in POST
api.get('/api', { retry: () => isOnline() ? 3 : 0 });      // MaybeFun

api.get('/api', {
  retry: {
    max: 3,
    delay: 200,
    shouldRetry: (resp) => resp?.data?.transient === true,
  },
});
```

`config.retry` is a `MaybeFun<number | boolean | IRetryOptions>`. Performance: when `config.retry` is `undefined` / `true` / equivalent-scalar, `$merge` returns the plugin-level config object **by reference** (zero allocation). Per-request overrides only allocate when fields actually differ.

## Countdown counter on `config.__retry`

```ts
import { isRetry, RETRY_KEY } from 'http-plugins';

api.use({
  name: 'my-plugin',
  install(ctx) {
    ctx.request((config) => {
      if (isRetry(config)) return config;  // skip on retried requests
      // ... do expensive idempotent work (replace path vars, build key, etc.)
      return config;
    });
  },
});
```

Sequence with `max=3`: original failure initializes `__retry=3`; each subsequent retry decrements (`2 → 1 → 0`). When the handler reads `__retry === 0` it knows the budget is gone and rejects. `max=-1` initializes `-1` and never decrements.

Built-in idempotent plugins that already opt-in to this skip:

- [`key`](../key/) — fingerprint is computed once on the first attempt
- [`filter`](../filter/) — params/data filtered once
- [`reurl`](../reurl/) — path variables substituted once; baseURL/url separators normalized once

Plugins that intentionally **do not** skip (must run on every retry):

- [`cache`](../cache/) — TTL may have expired between attempts
- [`cancel`](../cancel/) — every request needs a fresh `AbortController` (named-group intent IS persisted across retries — see cancel/README)
- [`loading`](../loading/) — must keep the global counter accurate
- [`share`](../share/) — adapter-level, by definition runs every dispatch
- [`normalize`](../normalize/) — wraps the *retry's* response too

## Cross-plugin short-circuits at attempt entry

Two `bag` flags inhibit retry from stacking another budget on top of a request that's already being re-dispatched by another plugin:

| Flag | Set by | Why retry skips |
|------|--------|-----------------|
| `__raceSettled` (`SHARE_SETTLED_KEY`) | [`share`](../share/) (race policy) | Caller already gets the winner's response from the shared promise — retrying loses the bandwidth |
| `_refreshed` (`AUTH_REFRESHED_KEY`) | [`auth`](../auth/) (Refresh / Replay) | This dispatch is auth's own re-attempt after refresh. Without this skip, `retry: { max: 3 }` would silently become "3 retries × (1 + N auth refreshes)" |

Both checks are at the very top of `$attempt(...)`: if the flag is true, retry resets `__retry` and returns the response as-is.

## Notes

- The plugin re-enters `ctx.axios.request(config)` to retry, so the **entire interceptor chain runs again** for every attempt (sans the idempotent plugins above). This is intentional: features like `cache` / `share` / `normalize` see the retried response correctly.
- On any terminal state (success / final-failure / cancel / `beforeRetry === false`), `__retry` is `delete`d from `config` so the same config object can be reused for unrelated future calls.
- For unbounded retry (`max: -1`), pair with a `shouldRetry` that eventually returns `false`, otherwise you'll loop forever.
