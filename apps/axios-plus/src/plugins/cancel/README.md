# `cancel`

**Globally shared** request registry (across all axios instances), grouped by the `aborter` field — pair with `cancelAll()` to abort live requests.

- `cancelAll()` — clear all groups (full sweep)
- `cancelAll('group')` — clear a named group (e.g., the `auth` group on logout)
- Module-level `Map<string, Set<AbortController>>`; entries auto-removed from groups when requests settle.

## Quick start

```ts
import cancelPlugin, { cancelAll } from 'http-plugins/plugins/cancel';

api.use(cancelPlugin());

// Default group: cancelAll() sweeps everything
ax.get('/list');
cancelAll();

// Named group: clear auth-related requests on logout
ax.get('/me', undefined, { aborter: 'auth' });
cancelAll('auth', 'logout');

// Custom controller — manual abort + still hit by cancelAll
const ctrl = new AbortController();
ax.get('/big', undefined, { aborter: ctrl });
ctrl.abort();

// Opt out entirely
ax.get('/realtime', undefined, { aborter: false });
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | Master switch; `false` doesn't install interceptors |

## Per-request `aborter` four-state semantics

| Value | Behavior |
| --- | --- |
| `false` | Skip the plugin entirely; no signal injection, no registry |
| `true` / undefined | Default group; respects user-provided `signal` / `cancelToken` if present |
| `string` | Named group (forcefully takes over `signal`) |
| `AbortController` | Use the user-supplied ctrl + register in default group |

## API

```ts
cancelAll(group?: string, reason?: string): number
```

- No `group` ⇒ wipes all groups (default + named).
- With `group` ⇒ only the named group (use `'__default__'` for the default group).
- Does not affect requests with `aborter: false` / user-supplied signal / cancelToken — they're not registered.

## Recommended `use()` order

`cancel` only adds a signal in the request interceptor and releases on response. It can sit early in the chain:

```ts
api.use([
  filterPlugin(),
  keyPlugin(),
  cachePlugin(),
  cancelPlugin(),     // ← early: ensures all outbound requests are registered
  normalizePlugin(),
  retryPlugin(),
]);
```

## Interaction with other plugins

- **retry**: cancel produces a normalized `code: 'CANCEL'` ApiResponse — by default `retry` **never retries** this code (even when `shouldRetry` returns true).
- **share**: when the head of a shared promise is canceled, all callers receive the same normalized CANCEL.
- **normalize**: turns `CanceledError` / abort errors into `ApiResponse(code='CANCEL', success=false, status=0)` — `try/catch` never sees the raw axios error.

## Re-dispatch (`retry` / `auth`-refresh / `auth`-replay) keeps groups intact

The first request interceptor pass consumes `config.aborter` and registers the controller on the group. When the **same** `config` is re-dispatched by `retry` / `auth.Refresh` / `auth.Replay`, the original `aborter` field is gone — without protection, the re-dispatch would silently fall back to the default group.

This plugin persists "reconstructible intent" on a hidden field `_cancel_intent` so re-dispatches preserve the group:

| First-pass `aborter` | Persisted `_cancel_intent` | Behavior on re-dispatch |
|---|---|---|
| `'payment'` (named group) | `'payment'` | Re-registers a fresh `AbortController` in `'payment'` |
| `false` (opt-out) | `false` | Re-dispatch also opts out |
| `true` / `null` / `undefined` | (not persisted) | Re-dispatch follows default-group rules — same outcome |
| `AbortController` instance | (not persisted) | A user-supplied controller can't be reused once aborted; re-dispatch falls back to default group. Use a named group string if you need cross-replay grouping |

Practical implication: `cancelAll('payment')` reliably aborts all live requests in the `'payment'` group, **including** any retry-attempt or auth-refresh replay of those requests.
