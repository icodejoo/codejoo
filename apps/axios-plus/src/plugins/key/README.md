# `key`

Generates a stable, deterministic fingerprint for each request. Other plugins (`cache`, `share`, `retry`'s logger) use this string as a join key.

- **FNV-1a** streaming hash, single-pass over `method` + `url` (+ `params` + `data` in deep mode).
- **Two modes**: `fastMode: true` (only `method+url`, ~µs/req) vs `fastMode: false` (full request, sub-ms even for large payloads).
- **Long-string sampling**: strings > 64 chars are sampled at head/middle/tail + length, avoiding O(N) hashing of huge tokens while keeping collision risk low.
- **Idempotent skip**: on retry requests (`isRetry(config) === true`) the interceptor short-circuits — fingerprint was computed on the first attempt and `method+url(+params/data)` are stable.

## Quick start

```ts
import keyPlugin from 'http-plugins/plugins/key';

api.use(keyPlugin({ fastMode: true }));   // global default

// Per-request
api.get('/api', { key: true });           // use plugin defaults
api.get('/api', { key: 'deep' });         // force deep hash for this call
api.get('/api', { key: 'manual-key-v1' }); // hard-coded literal
api.get('/api', { key: { fastMode: false, ignoreKeys: ['ts'] } });
```

## Options

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enable` | `boolean` | `true` | Plugin kill switch |
| `fastMode` | `boolean` | `false` | `true` = `method+url` only · `false` = full deep hash |
| `ignoreKeys` | `any[]` | — | Keys whose value shouldn't be filtered as "empty" |
| `ignoreValues` | `any[]` | — | Values that shouldn't be filtered (`===` match, `NaN` special-cased) |
| `before(config)` | hook *(deprecated)* | — | Runs before key computation. **Deprecated** — write your own request interceptor instead. |
| `after(config)` | hook *(deprecated)* | — | Runs after `config.key` is set. **Deprecated** — write your own request interceptor instead. |

## Per-request `config.key`

```ts
config.key === false / undefined   // → no key (interceptor short-circuits)
config.key === true                // → use plugin defaults
config.key === 'deep'              // → force deep mode (with plugin ignore lists)
config.key === 0                   // → '0' (numbers are stringified)
config.key === 42                  // → '42'
config.key === 'fixed-string'      // → used verbatim (must trim non-empty)
config.key === { fastMode, ignoreKeys, ignoreValues } // → field-level override
config.key === (config) => string  // → function form, return value used
```

## Why a stable key?

Without a deterministic per-request fingerprint, plugins that need request-equality (`cache`, `share`) would each invent their own keying logic. Centralizing it here means:

- One configuration surface (`fastMode`, `ignore*`)
- One representation: a base-36 string written to `config.key`
- Other plugins read `config.key` directly — no recomputation

## Internals

- The hash is **never cryptographic** — collisions are theoretically possible but vanishingly rare for typical HTTP traffic.
- Long-string sampling (head/mid/tail/length) is the main hash-economy tradeoff. For UUIDs and short IDs this is lossless; for long opaque tokens it's not, but the length is included so structurally-similar tokens diverge.
