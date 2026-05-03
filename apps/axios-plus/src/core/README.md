# `core/` — `Core<T>` class + `create()` factory

`Core<T>` is the single class users instantiate. It owns an `axios.AxiosInstance`, dispatches HTTP verbs (`get` / `post` / `put` / `delete` / `patch` / `head` / `options`), and threads plugin lifecycle through a `PluginManager`.

## Files

| File | Role |
|---|---|
| [`core.ts`](./core.ts) | `Core<T>` class implementation + dispatch glue + `create()` factory + axios-defaults clone helpers for `extends()` |
| [`types.ts`](./types.ts) | Public types: `CoreOptions` / `IBaseOptions` / `IMethodOptions` / `IHttpOptions` / `ICommonOptions` / `Named` / `HttpMethodLower` / `HttpPrototype<T>`. Internal type-machinery for path-to-payload inference (`_Indexed`, `LoosePath`, `EntryFor`, `ResolvePayload`, `Payload`, etc.) is module-private — only the surface type `HttpPrototype<T>` is exported |
| [`index.ts`](./index.ts) | Public barrel — `default` (Core), `create`, and the public types listed above |

## Public API

```ts
import { create } from 'http-plugins';
import axios from 'axios';

const api = create<MyApi>(axios.create({ baseURL: '/api' }), { debug: true });
api.use(retry({ max: 3 }));

// Typed dispatch when `MyApi extends model.PathRefs`:
const pet = await api.get('/pet/{petId}')({ petId: 7 });
```

`Core` exposes:

- `use(plugin | plugin[])` → install one or many; chained.
- `eject(name | Plugin | factory)` → remove a plugin (single string-name lookup internally).
- `plugins()` → snapshot `PluginRecord[]` for debugging.
- `extends(overrides)` → derive a child `Core` with a fresh axios instance (deep-cloned `headers` / `params` / `transformRequest` / `transformResponse` / `transitional`; shared `adapter` / `logger`).
- `axios` → the wrapped `AxiosInstance` (escape hatch).
- `get` / `post` / `put` / `delete` / `patch` / `head` / `options` → curry-shaped dispatchers: `api.get(path, methodConfig?)(payload?, config?)`.

## Type-perf knobs

The path-to-payload machinery in `types.ts` is tuned for IDE responsiveness on schemas with ~1000 paths. See the comment block in `types.ts` and the project root README's "Architecture" section for details.

## Why a class instead of a factory?

`Core<T>` mixes in `HttpPrototype<T>` via interface declaration merging:

```ts
export default interface Core<T = unknown> extends HttpPrototype<T> {}
export default class Core<T = unknown> { /* runtime */ }
```

The class supplies runtime behavior (plugin manager, dispatch); the interface declaration adds the typed verb methods. Users see `api.get`, `api.post`, etc. — strongly typed against `T`.
