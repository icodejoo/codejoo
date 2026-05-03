# `filter`

Strips empty fields (`null` / `undefined` / `NaN` / blank strings) from `params` and `data` before the request goes out — keeps server logs, signatures, and cache keys clean.

```ts
import filterPlugin from 'http-plugins/plugins/filter';

api.use(filterPlugin());                                       // defaults
api.use(filterPlugin({ ignoreKeys: ['ts'] }));                 // keep `ts` even if empty
api.use(filterPlugin({ predicate: ([k, v]) => v === 0 }));     // custom drop rule

api.get('/api', undefined, { filter: true });                          // use plugin defaults
api.get('/api', undefined, { filter: false });                         // skip
api.get('/api', undefined, { filter: { ignoreValues: [0] } });         // per-request override
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | Master switch; when `false`, the interceptor is installed but `runWhen` always returns false |
| `predicate` | `(kv) => boolean` | `defaultPredicate` | "Should drop" decision (return `true` to drop) |
| `ignoreKeys` | `string[]` | — | Keys that are kept regardless of the predicate |
| `ignoreValues` | `any[]` | — | Values that are kept regardless of the predicate (NaN aware) |
| `deep` | `boolean` | `false` | Recursively filter nested objects / arrays |

## Per-request `config.filter`

```ts
config.filter === false / null / 0 / ''   // skip this request
config.filter === true / undefined         // use plugin defaults
config.filter === { ignoreKeys?, ... }     // field-level override
config.filter === (config) => ...          // MaybeFun
```

## Default behavior

- One level deep by default. Nested filtering is intentionally off: `key` already deep-walks for hashing; doubling that work here would waste CPU. Pass `deep: true` (or `filter: { deep: true }`) to recurse — empty inner objects/arrays are preserved as empty containers, not dropped.
- **Retry short-circuit**: `isRetry(config) === true` makes the interceptor exit early — params/data were filtered on the first attempt and stay stable.
- `defaultPredicate` aligns with `key`'s default empty-value filter, so both plugins make the same call about what counts as "empty".

## opt-in default

`runWhen: (config) => enable && isEnabled(config.filter)` — the interceptor only runs when `config.filter` is truthy. To make all requests filter by default, wrap a higher-level interceptor or set `axios.defaults.filter = true`.
