# `rethrow`

**Tail-end reject plugin** — once `normalize` has collapsed every settle shape into a single onFulfilled flow, business callers can no longer use `try/catch` to catch errors. `rethrow` re-rejects the failure responses to restore intuitive semantics.

## Core contract

| Response shape | What rethrow does |
| --- | --- |
| `apiResp.success === true` | **Always resolves** — rethrow does nothing; the underlying API behavior is preserved. |
| `apiResp.success === false` | **Rejects by default** — caller catches via `.catch` and receives the `ApiResponse`. |

On the `success === true` path rethrow is a no-op — **no configuration** (including `config.rethrow:true` or `shouldRethrow`) can turn a successful response into a reject. This guarantees that "the API's behavior" stays the same whether or not rethrow is installed.

- Depends on `normalize`: `requirePlugin('normalize')`; the response interceptor reads `response.data: ApiResponse`.
- It is the only plugin in the chain that produces onRejected; every other plugin works on onFulfilled.

## Quick start

```ts
import rethrowPlugin from 'http-plugins/plugins/rethrow';

api.use([
  // ...
  normalizePlugin(),
  retryPlugin(),
  notificationPlugin({ ... }),
  rethrowPlugin({
    shouldRethrow: (apiResp) => apiResp.code === 'CANCEL' ? false : null,  // CANCEL is not an error
  }),
]);

// Business caller
try {
  const res = await api.get('/users')();
  console.log(res.data);   // ApiResponse — success===true
} catch (apiResp) {
  toast(apiResp.message ?? 'request failed');   // ApiResponse — success===false
}

// Single-request waiver (e.g. non-critical heartbeat where caller doesn't want try/catch)
api.get('/heartbeat', { rethrow: false });
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | Master switch; `false` skips installation entirely |
| `shouldRethrow` | `(apiResp, response, config) => boolean \| null \| undefined` | none | Custom decision, **only invoked when success===false**. Return `false` to let the failure resolve; `true` / `null` / `undefined` falls back to default reject |
| `transform` | `(apiResp, response) => any` | none | Custom reject value; defaults to rejecting `apiResp` directly |

## Decision flow

```text
0. apiResp.success === true        → resolve (contract; lower steps don't run)
1. config.rethrow === false        → resolve (per-request waiver)
2. shouldRethrow(...) === true     → reject
3. shouldRethrow(...) === false    → resolve
4. shouldRethrow(...) === null/undefined / not configured → fall through
5. else                            → reject
```

## Per-request config

```ts
declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     *   - false  → resolve this failure (waiver)
     *   - true / unset → use default (failure rejects)
     *   - function (config) => boolean — MaybeFun
     *
     * Cannot force-reject a success===true response — the contract preserves API behavior.
     */
    rethrow?: MaybeFunc<boolean | null | undefined>;
  }
}
```

## Recommended `use()` order

**Always last.** Reasoning:

```ts
api.use([
  // ... request side + adapter layer
  normalizePlugin(),       // 1. unify all settle shapes
  retryPlugin(),           // 2. retry on failure
  notificationPlugin(),    // 3. toast success / failure
  rethrowPlugin({ ... }),  // ← final decision: reject vs resolve
]);
```

If `rethrow` isn't last, anything it rejects flows to downstream onRejected handlers — and middle plugins lose the ability to treat success / failure responses uniformly.

## `transform`: custom reject value

```ts
class HttpError extends Error {
  constructor(public api: ApiResponse, public response: AxiosResponse) {
    super(api.message ?? 'request failed');
  }
}

rethrowPlugin({
  transform: (apiResp, response) => new HttpError(apiResp, response),
});

// Business side
try {
  await api.get('/x')();
} catch (e) {
  if (e instanceof HttpError) {
    console.error(e.api.code, e.response.status);
  }
}
```

## Migration note

Previous versions had `onError` and `nullable` options — both broke the "don't change success behavior" contract and have been removed:

| Old usage | New equivalent |
| --- | --- |
| `rethrowPlugin({ onError: false })` | `rethrowPlugin({ shouldRethrow: () => false })` or per-request `rethrow: false` |
| `rethrowPlugin({ nullable: false })` (reject success+null) | **`nullable` moved to normalize**: `normalizePlugin({ nullable: false })` — normalize marks null data as `apiResp.success=false`, then rethrow rejects naturally |
| `config.nullable` per-request | Still works, but now handled by normalize: see [normalize README](../normalize/README.md) |
| `config.rethrow: true` to force-reject a successful response | Removed — contract guarantees `success===true` always resolves |
