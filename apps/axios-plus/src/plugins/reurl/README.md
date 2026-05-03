# `reurl`

Rewrites `config.url` before the request goes out:

1. **Path variable substitution** — substitutes `{var}` / `[var]` / `:var` in `config.url` from `config.params` / `config.data`.
2. **Slash normalization** — fixes the join between `baseURL` and `url` so there is exactly one `/` between them, and collapses any `//` that path-vars or hand-written URLs introduced into the path.

```ts
import reurlPlugin from 'http-plugins/plugins/reurl';
api.use(reurlPlugin());

api.get('/user/{id}', { id: 42 });        // → /user/42, params: {}
api.delete('/post/:id', undefined, { data: 99 });  // → /post/99

// baseURL='https://x.com/api'  +  url='users'  → url='/users'   (missing slash added)
// baseURL='https://x.com/api/' +  url='/users' → url='users'    (extra slash removed)
// url='https://x.com//a//b'                    → url='https://x.com/a/b' (path-side // collapsed; protocol :// preserved)
```

## Options

| field      | default | meaning |
|------------|---------|---------|
| `enable`   | `true`  | Plugin master switch. `false` skips install entirely. |
| `pattern`  | `/{([^}]+)}\|\[([^\]]+)]\|(?<!:):([^\s/?#&=]+)/g` | Regex used to find placeholders. The default pattern uses a negative lookbehind `(?<!:)` on the colon form so the `://` of an absolute URL is **never** mistaken for a path variable. |
| `removeKey`| `true`  | Prune the consumed field from `params` / `data` so it doesn't double up as a query string or body field. |
| `fixSlash` | `true`  | Normalize the slash between `baseURL` and `url`, and collapse `//` runs in the path part of `url`. Absolute URLs (`https://...`) keep their `://` intact. |

## Lookup order

`params` first, then `data` (object field, or primitive `data` itself).

## Idempotent skip on retry

When `isRetry(config) === true` the interceptor short-circuits — the URL has already been rewritten and the source fields removed on the first attempt.