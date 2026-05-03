# `auth`

**Auth / token-refresh plugin** — encapsulates the "401 → refresh → replay" concurrent-refresh protocol so business code never has to reinvent token mutex logic.

- Depends on `normalize`: `requirePlugin('normalize')`; the response interceptor reads `response.data: ApiResponse`.
- Protected requests resolve via the `methods × urlPattern` intersection (with optional `isProtected` function override + per-request `config.protected` boolean override).
- **Single-decision router** `onFailure: (tm, response) => AuthFailureAction` — five-way enum dispatch (`Refresh / Replay / Deny / Expired / Others`). Replaces the older `shouldRefresh / isDeny / isExpired` triple-predicate chain.
- **Concurrent refresh protocol**: a single module-level `refreshing` promise — at most one `onRefresh` runs at a time, and all protected requests join the same window.
- **Automatic stale-token replay**: a response that came back with the old token (after refresh already completed) is replayed with the new token without re-invoking `onRefresh`.

## Quick start

```ts
import { authPlugin, normalizePlugin, retryPlugin, rethrowPlugin, TokenManager } from 'http-plugins';

const tm = new TokenManager();   // or your own ITokenManager impl

api.use([
  normalizePlugin({ success: (a) => a.code === '0000' }),
  authPlugin({
    enable: true,
    tokenManager: tm,

    // Which methods + URL patterns are protected (intersection)
    methods: '*',                                                // default '*'
    urlPattern: ['/api/users/*', '/api/orders/*', '!/api/users/login'],

    // Optional per-request override: config.protected: boolean | (config) => boolean

    // Refresh implementation — POST /refresh with refreshToken; ANY non-`false` return = success
    onRefresh: async (tm, response) => {
      const { data } = await axios.post('/auth/refresh', { rt: tm.refreshToken });
      tm.set(data.accessToken, data.refreshToken);
      // no explicit return ⇒ undefined, treated as success
    },

    onAccessExpired: async (tm, response) => {
      router.replace('/login');
    },

    onAccessDenied: async (tm, response) => {
      toast.error('Access denied');
    },

    // Optional: attach Authorization (or any other header) before each protected request
    ready: (tm, config) => {
      config.headers!.Authorization = tm.accessToken;
    },
  }),
  retryPlugin(),
  rethrowPlugin(),
]);
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | Master switch |
| `tokenManager` | `ITokenManager` | **required** | Supplies `accessToken / refreshToken / set / clear / toHeaders` |
| `methods` | `string \| string[]` | `'*'` | HTTP method whitelist; `'*'` matches all (fast-path) |
| `urlPattern` | `string \| string[]` | `'*'` | `URLPattern` pathname syntax + gitignore-style `!` negation |
| `isProtected` | `(config) => boolean \| null` | — | Function override layered above `methods × urlPattern` (return `null/undefined` to fall through) |
| `accessDeniedCode` | `string` | `'ACCESS_DENIED'` | Synthetic ApiResponse code when a protected request has no `accessToken` |
| `onFailure` | `(tm, response) => AuthFailureAction \| null` | `DEFAULT_ON_AUTH_FAILURE` | Single response router (see below) |
| `onRefresh` | `(tm, response) => unknown` | **required** | Refresh impl. Returns `false` / throws ⇒ failure; **anything else** (including `undefined`) ⇒ success |
| `onAccessExpired` | `(tm, response) => void` | **required** | Called on refresh failure / replayed-still-401 / 401 fallthrough |
| `onAccessDenied` | `(tm, response) => void` | aliased to `onAccessExpired` | Permission denied (default 403 path) |
| `ready` | `(tm, config) => void` | — | Hook before each protected request goes out (attach headers / sign / etc.) |

## `onFailure` & `AuthFailureAction`

```ts
import { AuthFailureAction, DEFAULT_ON_AUTH_FAILURE, authFailureFactory } from 'http-plugins';

enum AuthFailureAction {
  Refresh = 'refresh',  // → call onRefresh, replay original config on success
  Replay  = 'replay',   // → reuse same config, do NOT call onRefresh
  Deny    = 'deny',     // → call onAccessDenied, propagate response as-is
  Expired = 'expired',  // → tm.clear() + onAccessExpired, propagate
  Others  = 'others',   // → not our concern, propagate as-is (null/undefined/void = same)
}
```

The default `DEFAULT_ON_AUTH_FAILURE` (= `authFailureFactory('Authorization')`) routes by the following decision table:

| Condition | Action |
|-----------|--------|
| status not 401/403 | `Others` |
| `tm.accessToken` is empty | `401: Expired` / `403: Deny` |
| request did **not** carry token | `Replay` (re-send with current `tm.accessToken`) |
| request carried token == current | `Refresh` |
| request carried token != current (stale) | `Replay` |

### Customization patterns

**1. Business-code dispatch (extend default)**

```ts
import { AuthFailureAction, DEFAULT_ON_AUTH_FAILURE } from 'http-plugins';

onFailure: (tm, resp) => {
  if (resp.data?.code === 'TOKEN_EXPIRED') return AuthFailureAction.Refresh;
  return DEFAULT_ON_AUTH_FAILURE(tm, resp);
}
```

**2. Different header name**

```ts
import { authFailureFactory } from 'http-plugins';

onFailure: authFailureFactory('X-Token'),
ready: (tm, config) => { (config.headers as any)['X-Token'] = tm.accessToken; },
```

**3. Fully bespoke — multi-header signing / JWT payload equivalence / cookies / etc.**

```ts
onFailure: (tm, resp) => { /* return any AuthFailureAction */ }
```

## Concurrent refresh protocol

```
All protected requests → check `refreshing`
                          ├─ refreshing in flight → await it
                          │                          ├─ success → continue with new token
                          │                          └─ failure → throw, abort this request
                          └─ refreshing empty → send with current `tm.accessToken`

A failed response → onFailure routes:
  → Refresh → $startOrJoinRefresh
                ├─ refreshing empty → start new onRefresh
                └─ refreshing exists → await the same one
              ↓
              success → replay with same config (`_refreshed = true`)
              fail    → onAccessExpired
  → Replay  → replay with same config WITHOUT calling onRefresh (same `_refreshed = true`)
  → Deny    → onAccessDenied, propagate
  → Expired → tm.clear() + onAccessExpired, propagate
  → Others  → propagate
```

**Guarantee**: at most one `onRefresh` at a time; all 401s in the same window share the same refresh.

## Replay path: the new token comes from `ready`

When `auth` triggers a `Refresh` or `Replay`, it calls `ctx.axios.request(config)` — the **entire interceptor chain re-runs**, including the auth request interceptor itself. That second pass calls your `ready` hook again, so the freshly-set `tm.accessToken` is what actually gets attached to the replay.

The default `ITokenManager.toHeaders()` returns `{ Authorization: <accessToken> }`. A typical `ready` is one line:

```ts
ready: (tm, config) => Object.assign(config.headers ??= {}, tm.toHeaders() ?? {}),
```

Custom TM impls override `toHeaders()` to put the token elsewhere (`X-Token` / `Cookie` / multi-header signature), and the same `ready` keeps working.

## Cross-plugin behavior on retry / replay

Three `bag` fields ride on `config` to keep replays correct (cross-plugin contract, all in `helper.ts`):

| Field | Owner | Purpose |
|-------|-------|---------|
| `_protected` (`AUTH_PROTECTED_KEY`) | auth (per-attempt) | Marks "this request was vetted as protected"; cleared on each terminal response |
| `_refreshed` (`AUTH_REFRESHED_KEY`) | auth | Set before `Refresh`/`Replay` re-dispatch. Loop-guard for auth + **read by `retry`** to avoid stacking another retry budget on top of an auth replay |
| `_auth_decision` (`AUTH_DECISION_KEY`) | auth | Caches `isProtected(config)` result. Survives retries / replays so a per-request `protected: false` is **not** lost when `config.protected` gets consumed on first pass |

The `retry` plugin reads `_refreshed` at attempt entry: if true, it short-circuits — your `retry: { max: 3 }` stays **3 total**, not 3+3+1 across an `auth` refresh.

The `cancel` plugin similarly persists `aborter` intent (`_cancel_intent`) so a request marked `aborter: 'payment'` stays in the `'payment'` group across all retry / refresh / replay re-dispatches; `cancelAll('payment')` will hit them.

## Notes

- `protected` configuration is now `methods × urlPattern × isProtected` — there is no more `protected: ['/...']` shorthand at the top level. Old code should migrate to `urlPattern: ['/...']`.
- `shouldRefresh / isDeny / isExpired` were removed in favor of the single `onFailure` router. Migration: encode the routing logic as a `switch` returning `AuthFailureAction`.
- `onRefresh` no longer requires explicit `return true`. Side-effect-style implementations (just call your refresh API and `tm.set(...)`) are valid; only `return false` or thrown errors mean failure.
