# Mocker

A lightweight mock server built on **Bun + Hono**. Runs as a standalone HTTP server or as a **Vite plugin** with zero extra port. Supports hot reload, proxy fallback, auth, scenarios, request history, network simulation, and lifecycle hooks.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Creating Mock Files](#creating-mock-files)
  - [Route Decorators](#route-decorators)
  - [Auth Decorator](#auth-decorator)
  - [baseUrl](#baseurl)
  - [Request Object](#request-object)
  - [Response Helpers](#response-helpers)
  - [Scenario Helper](#scenario-helper)
- [Vite Plugin](#vite-plugin)
- [Proxy & Fallback](#proxy--fallback)
- [Priority Mode](#priority-mode)
- [Network Simulation](#network-simulation)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Management API](#management-api)
- [Built-in Example Modules](#built-in-example-modules)

---

## Quick Start

### Standalone server

```bash
bun run start                        # uses defaults (port 3000, src/)
bun run start --port 4000            # override port
bun run start --dir ./mocks          # override mock directory
bun run start --fallback http://api.dev.local
```

Create `mocker.config.ts` in your project root for persistent settings (see [Configuration](#configuration)).

### Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { mock } from 'mocker/vite'

export default defineConfig({
  plugins: [
    mock({
      dir: './src/mocks',          // optional, all options from MockerConfig work here
    }),
  ],
})
```

The plugin attaches to Vite's existing HTTP server — **no extra port**. Mock routes are intercepted before Vite's dev-proxy and HMR handlers.

---

## Configuration

All settings can come from three sources, merged in this order (later wins):

```
defaults  ←  mocker.config.ts  ←  CLI flags
```

### `mocker.config.ts`

```ts
import type { MockerConfig } from 'mocker/helpers'

export default {
  port: 3000,                        // standalone server port
  dir: './src',                      // directory scanned for mock files (recursive)
  enable: true,                      // false = disable mocks, all requests proxy through

  // Auth
  authToken: '',                     // if set, Authorization header must equal this value
  authValidator: undefined,          // (req) => boolean  custom validator, overrides authToken

  // Proxy (see Proxy & Fallback)
  fallback: '',                      // single catch-all proxy URL
  proxy: {},                         // multi-path proxy map

  // Priority (see Priority Mode)
  priority: true,                    // true = mock-first (default), false = proxy-first

  // Network simulation (see Network Simulation)
  network: undefined,

  // Lifecycle hooks (see Lifecycle Hooks)
  hooks: undefined,
} satisfies Partial<MockerConfig>
```

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `3000` | HTTP port |
| `--dir` | `./src` | Mock file directory |
| `--fallback` | — | Proxy fallback URL |
| `--enable` / `--no-enable` | `true` | Enable or disable mock handling |
| `--auth-token` | — | Required Authorization header value |

---

## Creating Mock Files

Any `.ts` file inside `dir` that does **not** start with `_` is loaded as a mock file.

The recommended format is a `class` with `static readonly baseUrl` and method decorators:

```ts
// src/product.ts
import { auth, get, post, put, del } from '../tools/decorators'
import type { MockRequest, MockResponse } from '../tools/types'

const store = [
  { id: 1, name: 'Widget', price: 9.99 },
  { id: 2, name: 'Gadget', price: 24.99 },
]

export default class ProductMock {
  static readonly baseUrl = '/api'

  @get('/products')
  list(_req: MockRequest, res: MockResponse) {
    return res.resolve(store)
  }

  @get('/products/:id')
  getById(req: MockRequest, res: MockResponse) {
    const item = store.find(p => p.id === Number(req.params.id))
    return item ? res.resolve(item) : res.reject('Not found', 404)
  }

  @auth
  @post('/products')
  create(req: MockRequest, res: MockResponse) {
    const item = { id: Date.now(), ...(req.body as object) } as typeof store[0]
    store.push(item)
    return res.resolve(item, 201)
  }

  @auth
  @put('/products/:id')
  update(req: MockRequest, res: MockResponse) {
    const idx = store.findIndex(p => p.id === Number(req.params.id))
    if (idx === -1) return res.reject('Not found', 404)
    store[idx] = { ...store[idx], ...(req.body as object), id: store[idx].id }
    return res.resolve(store[idx])
  }

  @auth
  @del('/products/:id')
  remove(req: MockRequest, res: MockResponse) {
    const idx = store.findIndex(p => p.id === Number(req.params.id))
    if (idx === -1) return res.reject('Not found', 404)
    store.splice(idx, 1)
    return res.resolve(null, 204)
  }
}
```

> Files are **hot-reloaded** on save. In-memory state (e.g. `store`) resets on each reload. Use module-level variables if you need persistence across reloads — they are re-evaluated on each hot-reload cycle.

---

### Route Decorators

Each decorator registers the method as an HTTP route handler.

```ts
import { get, post, put, patch, del, head, options } from '../tools/decorators'
```

| Decorator | HTTP method |
|-----------|-------------|
| `@get(path)` | GET |
| `@post(path)` | POST |
| `@put(path)` | PUT |
| `@patch(path)` | PATCH |
| `@del(path)` | DELETE |
| `@head(path)` | HEAD |
| `@options(path)` | OPTIONS |

`path` supports Hono path syntax: static segments, `:param`, and wildcards.

```ts
@get('/users')             // GET /api/users        (with baseUrl = '/api')
@get('/users/:id')         // GET /api/users/:id
@get('/files/*')           // wildcard
@post('/search')           // POST /api/search
```

The old computed-key format `['GET /api/users']()` is still supported for backward compatibility.

---

### Auth Decorator

`@auth` marks a route as requiring authentication. The server checks the `Authorization` header before the handler runs.

```ts
import { auth } from '../tools/decorators'
```

| Usage | Meaning |
|-------|---------|
| `@auth` | requires auth (default `true`) |
| `@auth()` | requires auth (same as above) |
| `@auth(true)` | requires auth (explicit) |
| `@auth(false)` | public route — no auth check |

When a protected route is called without a valid `Authorization` header the server returns `401 { error: 'Unauthorized' }` before the handler is invoked.

**Default auth logic** (no custom validator):
- If `authToken` is configured: header value must exactly equal `authToken`.
- If `authToken` is empty: any non-empty `Authorization` header is accepted.

**Custom validator** (via `authValidator` in config):

```ts
// mocker.config.ts
export default {
  authValidator: (req) => {
    const token = req.headers['authorization']?.replace('Bearer ', '')
    return token === 'super-secret'
  },
}
```

Multiple decorators on the same method are applied bottom-up (inner-first):

```ts
@auth(false)
@get('/public-endpoint')
publicRoute(req, res) { ... }
```

---

### baseUrl

`static readonly baseUrl` is prepended to every route path in the class, so you don't repeat a common prefix on every method.

```ts
export default class AuthMock {
  static readonly baseUrl = '/api/auth'

  @post('/login')        // → POST /api/auth/login
  login(req, res) { ... }

  @get('/me')            // → GET  /api/auth/me
  me(req, res) { ... }
}
```

`baseUrl` also works on the old plain-object format:

```ts
export default {
  baseUrl: '/api',
  ['GET /users'](req, res) { ... },    // → GET /api/users
}
```

---

### Request Object

```ts
interface MockRequest {
  method:  string                    // 'GET', 'POST', …
  path:    string                    // '/api/users/42'
  params:  Record<string, string>    // { id: '42' }  from :param segments
  query:   Record<string, string>    // { page: '2', limit: '20' }
  headers: Record<string, string>    // lowercase header names
  body:    unknown                   // parsed JSON for application/json; string for text/*; null otherwise
}
```

```ts
@get('/orders/:orderId/items/:itemId')
getItem(req: MockRequest, res: MockResponse) {
  const { orderId, itemId } = req.params
  const { currency = 'USD' } = req.query
  const token = req.headers['authorization']
  // ...
}

@post('/search')
search(req: MockRequest, res: MockResponse) {
  const { keyword, page = 1 } = req.body as { keyword: string; page?: number }
  // ...
}
```

---

### Response Helpers

The second argument to every handler is a `MockResponse` object with two helpers.

#### `res.resolve(data, statusCode?)`

Returns a successful JSON response.

```ts
res.resolve(data)            // 200 OK
res.resolve(data, 201)       // 201 Created
res.resolve(null, 204)       // 204 No Content
res.resolve({ list, total }) // any serializable value
```

#### `res.reject(message, statusCode?)`

Returns an error JSON response `{ error: message }`.

```ts
res.reject('Not found', 404)
res.reject('Unauthorized', 401)
res.reject('Something went wrong')      // defaults to 500
```

#### `res.resolve.delay(data, ms?, statusCode?)`

Same as `res.resolve` but waits `ms` milliseconds first. Useful for simulating slow responses without the global `network.latency` setting.

```ts
// 2 s delay (default)
return res.resolve.delay({ status: 'processing' })

// Custom delay
return res.resolve.delay(bigPayload, 800)

// Delay + custom status
return res.resolve.delay(created, 500, 201)
```

#### `res.reject.delay(message, ms?, statusCode?)`

Same as `res.reject` but with a delay.

```ts
return res.reject.delay('Gateway timeout', 3000, 504)
```

> The `network.latency` config option applies **on top of** any `.delay()` you set. Use `.delay()` for per-route control and `network.latency` for a global floor.

---

### Auto-Wrap Returns

Calling `res.resolve` / `res.reject` is optional. If a handler returns a plain value or throws, the router wraps it automatically:

| Handler does | Result |
|---|---|
| `return value` (object, string, number, array) | `200 OK` JSON |
| `return undefined` / no return | `200 OK` with `null` body |
| `return res.resolve(...)` | passed through as-is |
| `throw new Error(msg)` | `500 { error: msg }` |
| `throw new MockError(msg, status)` | `status { error: msg }` |

```ts
import { MockError } from '../tools/helpers'

export default class ItemMock {
  static readonly baseUrl = '/api'

  // Return a plain value — no res needed
  @get('/ping')
  ping() {
    return { pong: true }
  }

  // Async handlers work too
  @auth(false)
  @get('/items/:id')
  async getById(req: MockRequest) {
    const item = store.find(i => i.id === Number(req.params.id))
    if (!item) throw new MockError('Not found', 404)
    return item   // → 200 JSON
  }

  // throw Error → 500 automatically
  @get('/unstable')
  unstable() {
    throw new Error('database connection failed')
  }
}
```

**`MockError`** lets you control the HTTP status when throwing:

```ts
import { MockError } from '../tools/helpers'

throw new MockError('Not found', 404)         // 404 { error: 'Not found' }
throw new MockError('Forbidden', 403)         // 403 { error: 'Forbidden' }
throw new MockError('Internal server error')  // 500 (default)
```

---

### Scenario Helper

`scenario(name)` returns `true` when the named scenario is currently active. Use it to branch between different response shapes within one handler.

```ts
import { scenario } from '../tools/helpers'

@get('/checkout/summary')
summary(_req: MockRequest, res: MockResponse) {
  if (scenario('empty-cart'))   return res.resolve({ items: [], total: 0 })
  if (scenario('promo'))        return res.resolve({ items: [...], discount: 0.1, total: 89.99 })
  return res.resolve({ items: [...], total: 99.99 })
}
```

Switch scenarios via the [Management API](#management-api):

```bash
# Activate a scenario
curl -X POST http://localhost:3000/_mock/scenario \
  -H 'Content-Type: application/json' \
  -d '{ "name": "empty-cart" }'

# Clear active scenario
curl -X DELETE http://localhost:3000/_mock/scenario
```

---

## Vite Plugin

```ts
// vite.config.ts
import { mock } from 'mocker/vite'

export default {
  plugins: [
    mock({
      dir: './src/mocks',
      priority: true,
      proxy: {
        '/api/legacy': 'http://old-backend:8080',
      },
      network: { latency: 200 },
    }),
  ],
}
```

The plugin:
- Uses **Vite's own HTTP server** — no second port.
- Reuses **Vite's chokidar watcher** — no duplicate file-watch process.
- Intercepts requests **before** `server.proxy` and HMR: matched mock routes return immediately; unmatched routes fall through to `next()`, letting Vite's proxy or static handler take over.
- Works with `apply: 'serve'` only (no effect in production builds).

If you configure both `mock({ proxy: {...} })` and `server.proxy` in Vite config, Mocker's proxy runs first (for paths it knows about) and unmatched paths reach Vite's built-in proxy.

---

## Proxy & Fallback

### Single fallback

All unmatched requests are forwarded to one URL:

```ts
// mocker.config.ts
export default { fallback: 'http://api.staging.example.com' }
```

### Multi-path proxy

Route different URL prefixes to different backends. **Longest prefix wins.**

```ts
export default {
  proxy: {
    '/api/v2':      'http://new-backend:9000',
    '/api':         'http://old-backend:8080',
    '/static':      { target: 'http://cdn.example.com', rewrite: (p) => p.replace('/static', '') },
  },
}
```

`proxy` takes precedence over `fallback`. When both are set, `proxy` handles matching paths and `fallback` handles everything else.

#### `rewrite`

```ts
proxy: {
  '/assets': {
    target: 'https://cdn.example.com',
    rewrite: (path) => path.replace('/assets', '/v3/static'),
    // /assets/logo.png  →  https://cdn.example.com/v3/static/logo.png
  },
}
```

---

## Priority Mode

Controls what happens when a request arrives:

### `priority: true` (default) — mock first

```
request → mock routes → (miss) → proxy/fallback → 404
```

Mocks always win. Use this when you want complete control over the API surface.

### `priority: false` — proxy first

```
request → proxy/fallback → (404 from backend) → mock routes → 404
```

Useful when the real backend exists but some endpoints are missing. Real responses are preferred; mocks fill gaps.

```ts
// mocker.config.ts
export default {
  priority: false,
  fallback: 'http://api.dev.local',
}
```

---

## Network Simulation

Inject latency and random errors globally to all mock-handled responses.

```ts
// mocker.config.ts
export default {
  network: {
    // Fixed or random latency (ms)
    latency: 300,
    latency: { min: 100, max: 800 },

    // Probability of 500 error injection (0–1)
    errorRate: 0.05,   // 5% of responses become 500
  },
}
```

Network simulation applies **only to mock-handled routes**, not to proxied responses.

---

## Lifecycle Hooks

```ts
// mocker.config.ts
export default {
  hooks: {
    // Called after body is parsed, before the mock handler
    onRequest(req) {
      console.log(`→ ${req.method} ${req.path}`)
    },

    // Called after the mock response is built (and network simulation applied)
    onResponse(req, res, duration) {
      console.log(`← ${req.method} ${req.path} ${res.status} (${duration}ms)`)
    },

    // Called after a proxied response arrives
    // Return a new Response to replace it; return void to pass through
    onProxyResponse(req, res) {
      if (res.status === 401) {
        return Response.json({ error: 'token expired' }, { status: 401 })
      }
    },
  },
}
```

---

## Management API

All management routes are available at `/_mock/` regardless of `enable` state.

### `GET /_mock/status`

Returns current scenario and history size.

```json
{ "scenario": "promo", "historySize": 42 }
```

### `GET /_mock/scenario`

Returns the currently active scenario name (or `null`).

```json
{ "scenario": "empty-cart" }
```

### `POST /_mock/scenario`

Activate a scenario. Send `{ "name": null }` to clear.

```bash
curl -X POST http://localhost:3000/_mock/scenario \
  -H 'Content-Type: application/json' \
  -d '{ "name": "error-state" }'
```

```json
{ "scenario": "error-state" }
```

### `DELETE /_mock/scenario`

Clear the active scenario (same as `POST` with `{ "name": null }`).

```json
{ "scenario": null }
```

### `GET /_mock/history`

Retrieve request history. Stores the last 200 entries.

| Query param | Description |
|-------------|-------------|
| `path` | filter by path substring |
| `method` | filter by HTTP method (case-insensitive) |
| `limit` | max entries to return (default 200) |

```bash
curl 'http://localhost:3000/_mock/history?method=POST&limit=10'
```

```json
[
  {
    "id": 17,
    "timestamp": "2026-06-26T10:00:00.000Z",
    "method": "POST",
    "path": "/api/auth/login",
    "query": {},
    "body": { "account": "admin", "password": "..." },
    "status": 200,
    "duration": 3,
    "source": "mock"
  }
]
```

`source` is `"mock"` for routes handled by Mocker and `"proxy"` for forwarded requests.

### `DELETE /_mock/history`

Clear all history entries.

```json
{ "cleared": true }
```

### `POST /_mock/reset`

Clear both active scenario and all history in one call.

```json
{ "ok": true }
```

---

## Built-in Example Modules

The `src/` directory contains two fully-featured example modules you can adapt or delete.

### Auth module — `src/auth.ts`

Base URL: `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | public | Register new user. Body: `{ username?, email?, phone?, password, nickname? }` |
| POST | `/api/auth/login` | public | Password login `{ account, password }` or code login `{ phone/email, code }` |
| POST | `/api/auth/logout` | required | Revoke current session token |
| POST | `/api/auth/refresh-token` | public | Exchange `{ refreshToken }` for a new access token |
| POST | `/api/auth/send-code` | public | Send verification code. Body: `{ target, type }` where `type` is one of `register \| login \| reset \| bind`. Response includes the code (mock-only) |
| POST | `/api/auth/verify-code` | public | Verify a code. Body: `{ target, code, type }` |
| POST | `/api/auth/forgot-password` | public | Send password-reset code. Body: `{ account }` |
| POST | `/api/auth/reset-password` | public | Reset password. Body: `{ account, code, newPassword }` |
| POST | `/api/auth/oauth/:provider` | public | OAuth login. `provider`: `google \| github \| wechat \| apple \| facebook \| twitter \| line \| kakao`. Body: `{ accessToken }` or `{ code }` |
| GET | `/api/auth/me` | required | Return current user profile |
| PUT | `/api/auth/me` | required | Update profile. Body: `{ nickname?, avatar? }` |
| POST | `/api/auth/change-password` | required | Body: `{ oldPassword, newPassword }` |
| POST | `/api/auth/bind-phone` | required | Body: `{ phone, code }` |
| POST | `/api/auth/bind-email` | required | Body: `{ email, code }` |

**Login response shape:**

```json
{
  "user": { "id": 1, "username": "admin", "email": "...", "roles": ["admin"], ... },
  "accessToken": "mock_tk_...",
  "refreshToken": "mock_rt_...",
  "expiresIn": 7200
}
```

**Pre-seeded accounts:**

| username | password | roles |
|----------|----------|-------|
| `admin` | `Admin123!` | admin, user |
| `user` | `User123!` | user |

### Game module — `src/game.ts`

Base URL: `/api` — reads from `data/game.json` (~7 MB, 10 000+ entries).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/games` | Paginated list with filtering and sorting (query params) |
| GET | `/api/games/:id` | Single game by numeric ID |
| POST | `/api/games` | Create game. Body: game fields |
| POST | `/api/games/query` | Complex query via request body |
| PUT | `/api/games/:id` | Update game. Body: partial game fields |
| DELETE | `/api/games/:id` | Delete single game |
| DELETE | `/api/games` | Batch delete. Body: `{ ids: number[] }` |

**`GET /api/games` query params:**

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default 1) |
| `pageSize` | number | Items per page (1–200, default 20) |
| `gameName` | string | Name search (case-insensitive substring) |
| `gameKind` | string | Exact match |
| `gameSupplier` | string | Exact match |
| `platformId` | string | Exact match |
| `screenOrientation` | string | Exact match |
| `appGroup` | string | Exact match |
| `sortBy` | string | Field name to sort by |
| `sortOrder` | `asc` \| `desc` | Sort direction (default asc) |
| `flag`, `hotFlag`, `newFlag`, … | number | Numeric flag filters (exact match) |

**`POST /api/games/query` body:**

```json
{
  "filters": { "gameKind": "slot", "hotFlag": 1 },
  "page": 1,
  "pageSize": 20,
  "sortBy": "gameName",
  "sortOrder": "asc"
}
```

**Paginated response shape:**

```json
{
  "total": 1234,
  "page": 1,
  "pageSize": 20,
  "list": [ ... ]
}
```

---

## TypeScript Types Reference

```ts
// tools/types.ts

interface MockRequest {
  method:  string
  path:    string
  params:  Record<string, string>
  query:   Record<string, string>
  headers: Record<string, string>
  body:    unknown
}

interface MockResponse {
  resolve: {
    <T>(data: T, code?: number): Response
    delay<T>(data: T, ms?: number, code?: number): Promise<Response>
  }
  reject: {
    (message: string, code?: number): Response
    delay(message: string, ms?: number, code?: number): Promise<Response>
  }
}

type MockHandler = (req: MockRequest, res: MockResponse) => Response | Promise<Response>

interface LoadedRoute {
  method:       string
  path:         string
  handler:      MockHandler
  requiresAuth: boolean
}

interface MockerConfig {
  port:          number
  dir:           string
  fallback:      string
  proxy:         Record<string, ProxyTarget>
  priority?:     boolean
  enable:        boolean
  authToken:     string
  authValidator: ((req: MockRequest) => boolean) | undefined
  network?:      NetworkConfig
  hooks?:        HookConfig
}

type ProxyTarget = string | { target: string; rewrite?: (path: string) => string }

interface NetworkConfig {
  latency?:   number | { min: number; max: number }
  errorRate?: number
}

interface HookConfig {
  onRequest?:       (req: MockRequest) => void | Promise<void>
  onResponse?:      (req: MockRequest, res: Response, duration: number) => void | Promise<void>
  onProxyResponse?: (req: MockRequest, res: Response) => Response | void | Promise<Response | void>
}
```
