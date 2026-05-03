# `normalize`

**End-to-end normalization** — every axios settle shape (success / HTTP error / network / timeout / cancel / business error) is collapsed into `response.data: ApiResponse` and **resolved**. Downstream plugins and business code see one shape.

- **Should install before any adapter-wrapping plugin** that depends on `ApiResponse` semantics. There's no global enforcement; instead `retry` / `rethrow` / `notification` / `auth` each call `requirePlugin('normalize')`.
- **Always resolves** — business `try/catch` no longer has to branch on `AxiosError` / `CanceledError` / `AxiosResponse`.
- Pair with `rethrow` at the tail to opt-in `reject`-ing the `ApiResponse`.

## Quick start

```ts
import normalizePlugin, { NETWORK_ERR_CODE } from 'http-plugins/plugins/normalize';

api.use([
  // success is a required function — no default
  normalizePlugin({ success: (apiResp) => apiResp.code === '0000' }),
  // ... retry / share / loading / notification / rethrow
]);

const r = await api.get('/api/foo')();
if (r instanceof ApiResponse && !r.success) {
  if (r.code === NETWORK_ERR_CODE) { /* network issue */ }
}
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `success` | `(apiResp: ApiResponse) => boolean` | **none (required)** | Success decision function; receives an already-constructed `ApiResponse` (`.success=false` initially), returns boolean to decide the final success |
| `codeKeyPath` | `string \| (resp, err) => unknown` | `'code'` | Where to find the biz code (string path resolved against `response.data`) |
| `messageKeyPath` | `string \| function` | `'message'` | Where to find the biz message |
| `dataKeyPath` | `string \| function` | `'data'` | Where to find the biz data |
| `httpErrorCode` | `string` | `'HTTP_ERR'` | Placeholder code when HTTP 4xx/5xx without envelope |
| `networkErrorCode` | `string` | `'NETWORK_ERR'` | Placeholder code for network errors |
| `timeoutErrorCode` | `string` | `'TIMEOUT_ERR'` | Placeholder code for timeouts |
| `cancelCode` | `string` | `'CANCEL'` | Placeholder code for user abort |

> ⚠️ The previous scalar / array form of `success` is removed; the previous plugin-level `nullable` / `emptyable` are also **removed** — those semantics are now expressed inside your `success` function, or via per-request `config.nullable` / `config.emptyable` overrides.

## Success decision flow

```text
1. Extract envelope triple (code / message / data) and build ApiResponse(success=false) — assume failure
2. error path (network / 4xx-5xx with no envelope / timeout / cancel) → keep success=false
3. Otherwise call success(apiResp) (request-level override applied) — assign return to apiResp.success
4. If **request did NOT provide** success but did provide nullable / emptyable:
     - data is null/undefined → use request `nullable` to force-override apiResp.success
     - data is empty container ({} / [] / '') → use request `emptyable` to force-override
   (Request-provided success ⇒ full authority; nullable/emptyable do not participate.)
```

## Normalization matrix

| Scenario | Normalized result |
| --- | --- |
| HTTP 2xx + envelope | `ApiResponse` → `success(apiResp)` decides |
| HTTP 4xx/5xx with envelope | `ApiResponse` → `success` (typically rejects via biz code mismatch) |
| HTTP 4xx/5xx without envelope | `ApiResponse(success=false, code='HTTP_ERR')` |
| Network error (offline / DNS) | `ApiResponse(status=0, code='NETWORK_ERR', success=false)` |
| Timeout | `ApiResponse(status=0, code='TIMEOUT_ERR', success=false)` |
| User abort | `ApiResponse(status=0, code='CANCEL', success=false)` |

`ERR_CODES` constants are exported from `http-plugins/objects/ApiResponse` for `===` comparison.

## Per-request overrides

```ts
// 1. Per-request success function ⇒ takes full authority; nullable/emptyable ignored
ax.get('/x', {
  normalize: { success: (a) => a.status === 200 },
});

// 2. Per-request nullable / emptyable ⇒ overrides plugin-level success outcome
//    Top-level shorthand
ax.get('/heartbeat',  { nullable: true });   // null data forced to success
ax.get('/list-empty', { emptyable: true });  // empty container forced to success
//    Nested form (top-level wins on conflict)
ax.get('/x', { normalize: { nullable: true, emptyable: false } });

// 3. Skip normalization entirely (rare, e.g. downloads / SSE)
ax.get('/download', { normalize: false });
```

**Priority**: per-request `success` > top-level `nullable` / `emptyable` > `normalize.{nullable,emptyable}` > plugin-level `success`.

## Common patterns

### Strict: reject null/empty data by default

```ts
normalizePlugin({
  success: (a) =>
    a.code === '0000' &&
    a.data != null &&
    !(typeof a.data === 'object' && Object.keys(a.data).length === 0),
});
```

### Lenient: code only

```ts
normalizePlugin({ success: (a) => a.code === '0000' });
// → null / empty data are considered success
```

### Strict by default + per-request waiver

```ts
normalizePlugin({
  success: (a) => a.code === '0000' && a.data != null,
});

// Heartbeat allows null data:
ax.get('/heartbeat', { nullable: true });
```

## Division of labor with `rethrow`

- `normalize` decides `apiResp.success` (assume false → call success → request-level nullable/emptyable overrides).
- `rethrow` (at the chain tail) decides whether to **reject** based on `apiResp.success`.
- Business callers always receive an `ApiResponse`: success in `try`, failure in `catch`.
