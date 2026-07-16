# Mock Server Design

Date: 2026-06-26

## Overview

A lightweight local mock server built with Bun + Hono. Supports common HTTP methods, TypeScript-based mock definitions, JSON data sources, a fluent response helper API, hot reload, and fallback proxy to a real server.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| HTTP Framework | Hono |
| Language | TypeScript |
| File Watching | chokidar |
| CLI Parsing | Built-in `parseArgs` (Bun) |

---

## Project Structure

```
mocker/
├── src/              # User-authored mock definitions (user.ts, order.ts, auth.ts, ...)
├── data/             # User JSON data sources (users.json, orders.json, ...)
├── core/             # Framework internals
│   ├── server.ts     # Hono app creation and route registration
│   ├── loader.ts     # Scans mockDir and dynamically imports .ts files
│   ├── watcher.ts    # File watcher + hot reload
│   ├── router.ts     # Registers mock definitions as Hono routes
│   └── proxy.ts      # Fallback proxy logic
├── tools/
│   ├── cli.ts          # CLI entry point and config merging
│   ├── response.ts     # MockResponse helper class
│   ├── decorators.ts   # @auth decorator
│   └── types.ts        # Shared TypeScript type definitions
├── package.json
└── mocker.config.ts  # Optional project-level config (lower priority than CLI args)
```

---

## Configuration

### Priority Order

```
CLI args  >  mocker.config.ts  >  defaults
```

### `mocker.config.ts`

```ts
export default {
  port: 3000,
  mockDir: './src',
  fallback: '',       // empty = no proxy
  enable: true,       // false = bypass all mocks, forward everything to fallback
  authToken: '',      // token to match against Authorization header; empty = only check header exists
  authValidator: undefined as ((req: MockRequest) => boolean) | undefined,
                      // if a function, takes full control of auth; authToken is ignored
}
```

### CLI Args

```bash
mocker --port 4000 --mock-dir ./src --fallback https://api.prod.com --no-enable
```

---

## Mock File Format

Each `.ts` file in `mockDir` exports a default — either a plain **object** or a **class instance**. Both formats are supported; the loader detects which one at runtime.

### Object format (no decorators needed)

```ts
// src/order.ts
import orders from '../data/orders.json'

export default {
  'GET /api/orders': (req, res) => res.resolve(orders),
  'GET /api/slow':   (req, res) => res.delayResolve(orders),
  'GET /api/fail':   (req, res) => res.delayReject('Timeout', 1500, 503),
}
```

### Class format (supports `@auth`)

```ts
// src/user.ts
import { auth } from '../tools/decorators'
import users from '../data/users.json'

export default class UserMock {
  @auth(true)
  ['GET /api/users'](req: MockRequest, res: MockResponse) {
    return res.resolve(users)
  }

  @auth(true)
  ['POST /api/users'](req: MockRequest, res: MockResponse) {
    return res.resolve({ id: Date.now(), ...req.body }, 201)
  }

  @auth(false)                   // auth disabled for this route
  ['GET /api/users/:id'](req: MockRequest, res: MockResponse) {
    const user = users.find(u => u.id === Number(req.params.id))
    return user ? res.resolve(user) : res.reject('Not found', 404)
  }
}
```

TypeScript infers JSON types automatically via `resolveJsonModule: true`, so `res.resolve(users)` carries full type information without manual annotation.

---

## Type Definitions

```ts
// tools/types.ts

interface MockRequest {
  params: Record<string, string>    // path params: :id
  query: Record<string, string>     // query string: ?foo=bar
  body: unknown                     // parsed request body
  headers: Record<string, string>
  method: string
  path: string
}

interface MockResponse {
  resolve<T>(data: T, code?: number): Response
  reject(message: string, code?: number): Response
  delayResolve<T>(data: T, delay?: number, code?: number): Promise<Response>   // delay default: 2000
  delayReject(message: string, delay?: number, code?: number): Promise<Response> // delay default: 2000
}

type MockHandler = (req: MockRequest, res: MockResponse) => Response | Promise<Response>
type MockDefinition = Record<string, MockHandler>
```

---

## `@auth` Decorator

### Signature

```ts
// tools/decorators.ts
@auth(true)   // enable auth check for this route
@auth(false)  // disable auth check (pass through)
```

`@auth` is a method decorator factory. It marks a handler with auth metadata; the actual check runs at request time.

### Auth Check Logic (applied when `@auth(true)`)

```
authValidator is a function (from config)
  → call authValidator(req)
  → returns false → 401 Unauthorized
  → returns true  → proceed

authValidator is not a function
  → authToken is configured
      → Authorization header === authToken → proceed
      → mismatch → 401 Unauthorized
  → authToken is empty
      → Authorization header exists (non-empty) → proceed
      → missing → 401 Unauthorized
```

### 401 Response Shape

```json
{ "error": "Unauthorized" }
```

---

## Request Flow

```
Incoming request
  │
  ├─ enable === false
  │     └─ forward to fallback (error if fallback not configured)
  │
  └─ enable === true
        │
        ├─ matched mock rule → return mock response
        │
        └─ no match
              ├─ fallback configured → proxy to real server
              │     (method / headers / body / status passed through verbatim)
              └─ fallback not configured → 404 JSON: { error: 'No mock found', path }
```

---

## Hot Reload

chokidar watches `mockDir`. On any `.ts` file change:

1. Re-import the changed file using cache-busting: `` import(`${filePath}?t=${Date.now()}`) ``
2. Rebuild Hono routes without restarting the process — active connections are not dropped.
3. On load failure (syntax error etc.), print error + file path and skip that file; other routes remain active.

---

## Fallback Proxy

When a request is forwarded to the real server:

- Method, headers, and body are passed through verbatim.
- The real server's response status, headers, and body are returned to the client verbatim.
- If `enable === false` and no fallback is configured, the server logs an error and returns 502.
