# Mocker — Mock File Authoring Skill

Use this skill whenever a user asks you to **create, modify, or extend mock API endpoints** in this project.

---

## Project Overview

This is a Bun + Hono mock server. Mock files live in `src/` (configurable via `dir`). Each file exports a class that registers route handlers via decorators. The server hot-reloads on file change.

**Key imports:**

```ts
import { auth, get, post, put, patch, del } from '../tools/decorators'
import type { MockRequest, MockResponse } from '../tools/types'
// Optional: scenario branching
import { scenario } from '../tools/helpers'
```

---

## Mock File Structure

```ts
export default class FooMock {
  // Prepended to every route path in this class
  static readonly baseUrl = '/api'

  // Route decorator stacks bottom-up: @get runs first, @auth second
  @auth(false)
  @get('/items')
  list(req: MockRequest, res: MockResponse) {
    return res.resolve([])
  }

  @auth           // defaults to true (requires Authorization header)
  @post('/items')
  create(req: MockRequest, res: MockResponse) {
    return res.resolve({ id: Date.now(), ...(req.body as object) }, 201)
  }
}
```

**File placement:** `src/<name>.ts` — any `.ts` file not starting with `_`.

---

## Route Decorators

| Decorator | HTTP method |
|-----------|-------------|
| `@get(path)` | GET |
| `@post(path)` | POST |
| `@put(path)` | PUT |
| `@patch(path)` | PATCH |
| `@del(path)` | DELETE |
| `@head(path)` | HEAD |
| `@options(path)` | OPTIONS |

Path supports Hono syntax: `:param`, wildcards `*`.

---

## Auth Decorator

| Syntax | Behavior |
|--------|----------|
| `@auth` | requires auth (default) |
| `@auth()` | requires auth (same) |
| `@auth(true)` | requires auth (explicit) |
| `@auth(false)` | public — no check |

When a protected route is called without a valid `Authorization` header the server returns `401` before the handler runs. The handler itself does not need to re-check.

---

## Request Object

```ts
req.method       // 'GET' | 'POST' | …
req.path         // '/api/items/42'
req.params       // { id: '42' }  — from :param segments
req.query        // { page: '2', limit: '10' }  — query string
req.headers      // { 'content-type': 'application/json', 'authorization': '…' }
req.body         // parsed JSON object for application/json | string for text/* | null otherwise
```

---

## Response Helpers

```ts
// Success
res.resolve(data)               // 200
res.resolve(data, 201)          // custom status
res.resolve(null, 204)          // no content

// Error  →  { error: message }
res.reject('Not found', 404)
res.reject('Server error')      // 500

// Delayed responses (per-route, adds to any global network.latency)
await res.resolve.delay(data)             // 2 s default
await res.resolve.delay(data, 500)        // 500 ms
await res.resolve.delay(data, 500, 201)   // 500 ms + status 201
await res.reject.delay('timeout', 3000, 504)
```

## Auto-Wrap Returns

You can skip `res.resolve`/`res.reject` entirely by returning or throwing:

```ts
// return a value → wrapped as res.resolve(value, 200)
@get('/ping')
ping() {
  return { pong: true }
}

// async works too
@get('/users')
async list() {
  return await fetchUsers()
}

// throw Error → { error: message } with status 500
@get('/broken')
broken() {
  throw new Error('something went wrong')
}

// throw MockError → custom status code
import { MockError } from '../tools/helpers'

@get('/items/:id')
getById(req: MockRequest) {
  const item = store.find(i => i.id === Number(req.params.id))
  if (!item) throw new MockError('Not found', 404)
  return item
}
```

| Return / throw | Result |
|---|---|
| Plain value (object, string, number, array) | `200` JSON |
| `undefined` / no return | `200 null` |
| Already a `Response` | passed through as-is |
| `throw new Error(msg)` | `500 { error: msg }` |
| `throw new MockError(msg, status)` | `status { error: msg }` |

---

## Scenario Branching

```ts
import { scenario } from '../tools/helpers'

@get('/orders')
list(_req: MockRequest, res: MockResponse) {
  if (scenario('empty'))   return res.resolve({ list: [], total: 0 })
  if (scenario('error'))   return res.reject('Service unavailable', 503)
  return res.resolve({ list: [...data], total: data.length })
}
```

Switch via `POST /_mock/scenario` with `{ "name": "empty" }`.  
Clear via `DELETE /_mock/scenario`.

---

## Common CRUD Pattern

```ts
import { auth, get, post, put, del } from '../tools/decorators'
import type { MockRequest, MockResponse } from '../tools/types'

interface Item { id: number; name: string }

let store: Item[] = [{ id: 1, name: 'Example' }]

export default class ItemMock {
  static readonly baseUrl = '/api'

  @auth(false)
  @get('/items')
  list(req: MockRequest, res: MockResponse) {
    const { page = '1', pageSize = '20' } = req.query
    const p = Number(page), ps = Number(pageSize)
    const list = store.slice((p - 1) * ps, p * ps)
    return res.resolve({ total: store.length, page: p, pageSize: ps, list })
  }

  @auth(false)
  @get('/items/:id')
  getById(req: MockRequest, res: MockResponse) {
    const item = store.find(i => i.id === Number(req.params.id))
    return item ? res.resolve(item) : res.reject('Not found', 404)
  }

  @auth
  @post('/items')
  create(req: MockRequest, res: MockResponse) {
    const item = { id: Date.now(), ...(req.body as Omit<Item, 'id'>) }
    store.push(item)
    return res.resolve(item, 201)
  }

  @auth
  @put('/items/:id')
  update(req: MockRequest, res: MockResponse) {
    const idx = store.findIndex(i => i.id === Number(req.params.id))
    if (idx === -1) return res.reject('Not found', 404)
    store[idx] = { ...store[idx], ...(req.body as Partial<Item>), id: store[idx].id }
    return res.resolve(store[idx])
  }

  @auth
  @del('/items/:id')
  remove(req: MockRequest, res: MockResponse) {
    const idx = store.findIndex(i => i.id === Number(req.params.id))
    if (idx === -1) return res.reject('Not found', 404)
    store.splice(idx, 1)
    return res.resolve(null, 204)
  }
}
```

---

## Checklist When Creating a Mock File

- [ ] Place in `src/` (or configured `dir`), filename does not start with `_`
- [ ] `export default class` with `static readonly baseUrl`
- [ ] One named method per route — the method name describes the action, not the path
- [ ] Decorator order: `@auth` on top, route decorator below (decorators apply bottom-up)
- [ ] Public endpoints: `@auth(false)` — protected endpoints: `@auth` (no args)
- [ ] Game/list endpoints: return paginated shape `{ total, page, pageSize, list }`
- [ ] `res.resolve(null, 204)` for DELETE with no response body
- [ ] Use `res.reject('…', 404)` for not-found, `res.reject('…', 400)` for bad input
- [ ] Scenario branches at the top of the handler (check all `scenario()` cases first, then default)

---

## What NOT to Do

- Do not write async handlers unless using `res.resolve.delay` / external calls — Hono handlers are synchronous by default
- Do not use `this` to share state between methods — use module-level `let` variables
- Do not add `_` prefix to filenames unless you intentionally want them excluded from loading
- Do not use `@auth(true)` — `@auth` alone is equivalent and shorter
- Do not embed the full base path in every route key (`@get('/api/users')`) — set `baseUrl = '/api'` and use `@get('/users')`
