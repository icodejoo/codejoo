# Mock Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local mock server with Bun + Hono that supports TypeScript mock definitions, hot reload, `@auth` decorators, and fallback proxy to a real server.

**Architecture:** `core/server.ts` orchestrates everything — it scans mock files via `core/loader.ts`, builds a Hono app via `core/router.ts`, enables hot reload via `core/watcher.ts`, and proxies unmatched requests via `core/proxy.ts`. The `tools/` directory contains the CLI entry, shared types, response helper, and the `@auth` decorator.

**Tech Stack:** Bun (runtime + test runner), Hono (HTTP framework), chokidar (file watching), TypeScript with `experimentalDecorators`

## Global Constraints

- Bun >= 1.0; use `Bun.*` APIs where available, not Node.js equivalents
- TypeScript strict mode; no `any` except where explicitly noted with a comment
- `experimentalDecorators: true` in tsconfig (legacy decorator API)
- `resolveJsonModule: true` in tsconfig
- Test runner: `bun test` (Jest-compatible API via `bun:test`)
- All mock files in `src/` use `.ts` extension
- Default delay for `delayResolve`/`delayReject`: 2000ms
- Default port: 3000, default mockDir: `./src`
- Config priority: CLI args > `mocker.config.ts` > defaults

---

### Task 1: Project Bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/.gitkeep`, `data/.gitkeep`, `tests/fixtures/.gitkeep`
- Create: `core/`, `tools/` directories

**Interfaces:**
- Produces: working `bun test` and `bun run tools/cli.ts` commands

- [ ] **Step 1: Initialize Bun project**

```bash
bun init -y
```

Expected: `package.json` created with `"name": "mocker"`.

- [ ] **Step 2: Install dependencies**

```bash
bun add hono chokidar
```

Expected: both packages appear in `package.json` dependencies.

- [ ] **Step 3: Replace tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "experimentalDecorators": true,
    "resolveJsonModule": true,
    "types": ["bun-types"]
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Replace package.json**

```json
{
  "name": "mocker",
  "version": "0.1.0",
  "scripts": {
    "start": "bun run tools/cli.ts",
    "test": "bun test"
  },
  "bin": {
    "mocker": "./tools/cli.ts"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "hono": "^4.0.0"
  }
}
```

- [ ] **Step 5: Create directory structure**

```bash
mkdir -p src data tests/fixtures core tools
```

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "chore: project bootstrap — Bun + Hono + chokidar"
```

---

### Task 2: Shared Types

**Files:**
- Create: `tools/types.ts`

**Interfaces:**
- Produces: `MockRequest`, `MockResponse`, `MockHandler`, `LoadedRoute`, `MockerConfig` — consumed by every subsequent task

- [ ] **Step 1: Write tools/types.ts**

```ts
export interface MockRequest {
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
  headers: Record<string, string>
  method: string
  path: string
}

export interface MockResponse {
  resolve<T>(data: T, code?: number): Response
  reject(message: string, code?: number): Response
  delayResolve<T>(data: T, delay?: number, code?: number): Promise<Response>
  delayReject(message: string, delay?: number, code?: number): Promise<Response>
}

export type MockHandler = (req: MockRequest, res: MockResponse) => Response | Promise<Response>

export interface LoadedRoute {
  method: string        // 'GET', 'POST', etc.
  path: string          // '/api/users', '/api/users/:id'
  handler: MockHandler
  requiresAuth: boolean
}

export interface MockerConfig {
  port: number
  mockDir: string
  fallback: string
  enable: boolean
  authToken: string
  authValidator: ((req: MockRequest) => boolean) | undefined
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/types.ts
git commit -m "feat: shared TypeScript types"
```

---

### Task 3: Response Helper

**Files:**
- Create: `tools/response.ts`
- Create: `tests/response.test.ts`

**Interfaces:**
- Consumes: `MockResponse` from `tools/types.ts`
- Produces: `createResponse(): MockResponse`

- [ ] **Step 1: Write failing tests**

```ts
// tests/response.test.ts
import { describe, it, expect } from 'bun:test'
import { createResponse } from '../tools/response'

describe('createResponse', () => {
  it('resolve returns 200 JSON by default', async () => {
    const r = createResponse().resolve({ name: 'Alice' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ name: 'Alice' })
  })

  it('resolve accepts custom status code', async () => {
    const r = createResponse().resolve({ id: 1 }, 201)
    expect(r.status).toBe(201)
  })

  it('reject returns 500 JSON by default', async () => {
    const r = createResponse().reject('Something broke')
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ error: 'Something broke' })
  })

  it('reject accepts custom status code', async () => {
    const r = createResponse().reject('Not found', 404)
    expect(r.status).toBe(404)
  })

  it('delayResolve resolves after delay', async () => {
    const start = Date.now()
    const r = await createResponse().delayResolve({ ok: true }, 100)
    expect(Date.now() - start).toBeGreaterThanOrEqual(90)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('delayResolve with delay=0 works as resolve', async () => {
    const r = await createResponse().delayResolve({ ok: true }, 0)
    expect(r.status).toBe(200)
  })

  it('delayReject rejects after delay with correct status', async () => {
    const r = await createResponse().delayReject('timeout', 100, 503)
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'timeout' })
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test tests/response.test.ts
```

Expected: FAIL — `Cannot find module '../tools/response'`

- [ ] **Step 3: Implement tools/response.ts**

```ts
import type { MockResponse } from './types'

const DEFAULT_DELAY = 2000

export function createResponse(): MockResponse {
  return {
    resolve<T>(data: T, code = 200): Response {
      return Response.json(data, { status: code })
    },

    reject(message: string, code = 500): Response {
      return Response.json({ error: message }, { status: code })
    },

    async delayResolve<T>(data: T, delay = DEFAULT_DELAY, code = 200): Promise<Response> {
      await new Promise(r => setTimeout(r, delay))
      return Response.json(data, { status: code })
    },

    async delayReject(message: string, delay = DEFAULT_DELAY, code = 500): Promise<Response> {
      await new Promise(r => setTimeout(r, delay))
      return Response.json({ error: message }, { status: code })
    },
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test tests/response.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/response.ts tests/response.test.ts
git commit -m "feat: MockResponse helper with resolve/reject/delay variants"
```

---

### Task 4: @auth Decorator

**Files:**
- Create: `tools/decorators.ts`
- Create: `tests/decorators.test.ts`

**Interfaces:**
- Produces: `auth(enabled: boolean)` — method decorator factory; `getAuthEnabled(fn: object): boolean | undefined` — reads auth metadata

- [ ] **Step 1: Write failing tests**

```ts
// tests/decorators.test.ts
import { describe, it, expect } from 'bun:test'
import { auth, getAuthEnabled } from '../tools/decorators'

describe('auth decorator', () => {
  it('getAuthEnabled returns true for @auth(true)', () => {
    class Mock {
      @auth(true)
      ['GET /api/users']() {}
    }
    expect(getAuthEnabled(Mock.prototype['GET /api/users'])).toBe(true)
  })

  it('getAuthEnabled returns false for @auth(false)', () => {
    class Mock {
      @auth(false)
      ['GET /api/public']() {}
    }
    expect(getAuthEnabled(Mock.prototype['GET /api/public'])).toBe(false)
  })

  it('getAuthEnabled returns undefined for undecorated method', () => {
    class Mock {
      ['GET /api/plain']() {}
    }
    expect(getAuthEnabled(Mock.prototype['GET /api/plain'])).toBeUndefined()
  })

  it('decorator does not alter method behavior', () => {
    class Mock {
      @auth(true)
      ['GET /test']() { return 'hello' }
    }
    expect(new Mock()['GET /test']()).toBe('hello')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test tests/decorators.test.ts
```

Expected: FAIL — `Cannot find module '../tools/decorators'`

- [ ] **Step 3: Implement tools/decorators.ts**

```ts
const authMeta = new WeakMap<object, boolean>()

export function auth(enabled: boolean) {
  return function (
    _target: object,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    authMeta.set(descriptor.value as object, enabled)
    return descriptor
  }
}

export function getAuthEnabled(fn: object): boolean | undefined {
  return authMeta.get(fn)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test tests/decorators.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/decorators.ts tests/decorators.test.ts
git commit -m "feat: @auth decorator with WeakMap metadata storage"
```

---

### Task 5: Config Loader

**Files:**
- Create: `tools/config.ts`
- Create: `tests/config.test.ts`

**Interfaces:**
- Consumes: `MockerConfig` from `tools/types.ts`
- Produces: `defaultConfig: MockerConfig`, `mergeConfig(base, overrides): MockerConfig`, `loadConfigFile(path): Promise<Partial<MockerConfig>>`

- [ ] **Step 1: Write failing tests**

```ts
// tests/config.test.ts
import { describe, it, expect } from 'bun:test'
import { defaultConfig, mergeConfig } from '../tools/config'

describe('defaultConfig', () => {
  it('has expected default values', () => {
    expect(defaultConfig.port).toBe(3000)
    expect(defaultConfig.mockDir).toBe('./src')
    expect(defaultConfig.fallback).toBe('')
    expect(defaultConfig.enable).toBe(true)
    expect(defaultConfig.authToken).toBe('')
    expect(defaultConfig.authValidator).toBeUndefined()
  })
})

describe('mergeConfig', () => {
  it('returns defaults when overrides is empty', () => {
    expect(mergeConfig(defaultConfig, {})).toEqual(defaultConfig)
  })

  it('override values take precedence', () => {
    const result = mergeConfig(defaultConfig, { port: 4000, fallback: 'https://api.prod.com' })
    expect(result.port).toBe(4000)
    expect(result.fallback).toBe('https://api.prod.com')
    expect(result.mockDir).toBe(defaultConfig.mockDir)
  })

  it('undefined override values do not overwrite defaults', () => {
    const result = mergeConfig(defaultConfig, { port: undefined })
    expect(result.port).toBe(defaultConfig.port)
  })

  it('enable: false is preserved', () => {
    const result = mergeConfig(defaultConfig, { enable: false })
    expect(result.enable).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test tests/config.test.ts
```

Expected: FAIL — `Cannot find module '../tools/config'`

- [ ] **Step 3: Implement tools/config.ts**

```ts
import type { MockerConfig } from './types'
import { existsSync } from 'fs'
import { resolve } from 'path'

export const defaultConfig: MockerConfig = {
  port: 3000,
  mockDir: './src',
  fallback: '',
  enable: true,
  authToken: '',
  authValidator: undefined,
}

export function mergeConfig(
  base: MockerConfig,
  overrides: Partial<MockerConfig>
): MockerConfig {
  const result = { ...base }
  for (const key of Object.keys(overrides) as (keyof MockerConfig)[]) {
    const value = overrides[key]
    if (value !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(result as any)[key] = value
    }
  }
  return result
}

export async function loadConfigFile(configPath: string): Promise<Partial<MockerConfig>> {
  const absPath = resolve(configPath)
  if (!existsSync(absPath)) return {}
  try {
    const mod = await import(`${absPath}?t=${Date.now()}`)
    return (mod.default ?? {}) as Partial<MockerConfig>
  } catch {
    console.warn(`[mocker] Failed to load config file: ${absPath}`)
    return {}
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test tests/config.test.ts
```

Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/config.ts tests/config.test.ts
git commit -m "feat: config loader with CLI > file > defaults merging"
```

---

### Task 6: Fallback Proxy

**Files:**
- Create: `core/proxy.ts`
- Create: `tests/proxy.test.ts`

**Interfaces:**
- Produces: `proxyRequest(req: Request, fallbackUrl: string): Promise<Response>`

- [ ] **Step 1: Write failing tests**

```ts
// tests/proxy.test.ts
import { describe, it, expect } from 'bun:test'
import { proxyRequest } from '../core/proxy'

describe('proxyRequest', () => {
  it('forwards method, path, headers to the fallback URL', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url.toString(), init: init ?? {} })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const req = new Request('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      body: JSON.stringify({ name: 'Alice' }),
    })

    const res = await proxyRequest(req, 'https://api.prod.com')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.prod.com/api/users')
    expect(calls[0].init.method).toBe('POST')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    globalThis.fetch = originalFetch
  })

  it('passes query string through unchanged', async () => {
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url: string | URL | Request) => {
      calls.push(url.toString())
      return new Response('{}', { status: 200 })
    }

    await proxyRequest(
      new Request('http://localhost:3000/api/users?page=2&limit=10'),
      'https://api.prod.com'
    )

    expect(calls[0]).toBe('https://api.prod.com/api/users?page=2&limit=10')
    globalThis.fetch = originalFetch
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test tests/proxy.test.ts
```

Expected: FAIL — `Cannot find module '../core/proxy'`

- [ ] **Step 3: Implement core/proxy.ts**

```ts
export async function proxyRequest(req: Request, fallbackUrl: string): Promise<Response> {
  const url = new URL(req.url)
  const target = new URL(url.pathname + url.search, fallbackUrl)
  return fetch(target.toString(), {
    method: req.method,
    headers: new Headers(req.headers),
    body: req.body,
    // @ts-ignore — required for streaming body passthrough in Bun
    duplex: 'half',
  })
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test tests/proxy.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/proxy.ts tests/proxy.test.ts
git commit -m "feat: fallback proxy — passes through method/headers/body/status verbatim"
```

---

### Task 7: Mock File Loader

**Files:**
- Create: `core/loader.ts`
- Create: `tests/fixtures/object-mock.ts`
- Create: `tests/fixtures/class-mock.ts`
- Create: `tests/loader.test.ts`

**Interfaces:**
- Consumes: `MockHandler`, `LoadedRoute` from `tools/types.ts`; `getAuthEnabled` from `tools/decorators.ts`
- Produces: `loadMockFile(filePath: string): Promise<LoadedRoute[]>`, `scanMockDir(dir: string): Promise<string[]>`

- [ ] **Step 1: Create fixture files**

```ts
// tests/fixtures/object-mock.ts
import type { MockRequest, MockResponse } from '../../tools/types'

export default {
  'GET /api/items': (_req: MockRequest, res: MockResponse) => res.resolve([{ id: 1 }]),
  'POST /api/items': (_req: MockRequest, res: MockResponse) => res.resolve({ id: 2 }, 201),
}
```

```ts
// tests/fixtures/class-mock.ts
import { auth } from '../../tools/decorators'
import type { MockRequest, MockResponse } from '../../tools/types'

export default class ClassMock {
  @auth(true)
  ['GET /api/secure'](_req: MockRequest, res: MockResponse) {
    return res.resolve({ secret: true })
  }

  @auth(false)
  ['DELETE /api/public'](_req: MockRequest, res: MockResponse) {
    return res.resolve(null, 204)
  }
}
```

- [ ] **Step 2: Write failing tests**

```ts
// tests/loader.test.ts
import { describe, it, expect } from 'bun:test'
import { resolve } from 'path'
import { loadMockFile, scanMockDir } from '../core/loader'
import { createResponse } from '../tools/response'
import type { MockRequest } from '../tools/types'

const FIXTURES = resolve(import.meta.dir, 'fixtures')

function mockReq(method = 'GET', path = '/'): MockRequest {
  return { method, path, params: {}, query: {}, body: null, headers: {} }
}

describe('loadMockFile — object format', () => {
  it('returns 2 routes from the object fixture', async () => {
    const routes = await loadMockFile(`${FIXTURES}/object-mock.ts`)
    expect(routes).toHaveLength(2)
  })

  it('parses method and path correctly', async () => {
    const routes = await loadMockFile(`${FIXTURES}/object-mock.ts`)
    const get = routes.find(r => r.method === 'GET')!
    expect(get.path).toBe('/api/items')
    expect(get.requiresAuth).toBe(false)
  })

  it('handler is callable and returns a Response', async () => {
    const routes = await loadMockFile(`${FIXTURES}/object-mock.ts`)
    const get = routes.find(r => r.method === 'GET')!
    const r = await get.handler(mockReq('GET', '/api/items'), createResponse())
    expect(r.status).toBe(200)
  })
})

describe('loadMockFile — class format', () => {
  it('returns 2 routes from the class fixture', async () => {
    const routes = await loadMockFile(`${FIXTURES}/class-mock.ts`)
    expect(routes).toHaveLength(2)
  })

  it('reads @auth(true) on GET /api/secure', async () => {
    const routes = await loadMockFile(`${FIXTURES}/class-mock.ts`)
    const secure = routes.find(r => r.path === '/api/secure')!
    expect(secure.requiresAuth).toBe(true)
  })

  it('reads @auth(false) on DELETE /api/public', async () => {
    const routes = await loadMockFile(`${FIXTURES}/class-mock.ts`)
    const pub = routes.find(r => r.path === '/api/public')!
    expect(pub.requiresAuth).toBe(false)
  })
})

describe('scanMockDir', () => {
  it('returns .ts files from the directory', async () => {
    const files = await scanMockDir(FIXTURES)
    expect(files.some(f => f.endsWith('object-mock.ts'))).toBe(true)
    expect(files.some(f => f.endsWith('class-mock.ts'))).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
bun test tests/loader.test.ts
```

Expected: FAIL — `Cannot find module '../core/loader'`

- [ ] **Step 4: Implement core/loader.ts**

```ts
import { readdirSync } from 'fs'
import { resolve, extname } from 'path'
import { getAuthEnabled } from '../tools/decorators'
import type { LoadedRoute, MockHandler } from '../tools/types'

const ROUTE_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) \//

function parseKey(key: string): { method: string; path: string } | null {
  if (!ROUTE_RE.test(key)) return null
  const idx = key.indexOf(' ')
  return { method: key.slice(0, idx), path: key.slice(idx + 1) }
}

function fromObject(obj: Record<string, MockHandler>): LoadedRoute[] {
  return Object.entries(obj)
    .flatMap(([key, handler]) => {
      const parsed = parseKey(key)
      if (!parsed || typeof handler !== 'function') return []
      return [{ ...parsed, handler, requiresAuth: false }]
    })
}

function fromClass(Ctor: new () => object): LoadedRoute[] {
  const instance = new Ctor()
  const proto = Object.getPrototypeOf(instance) as Record<string, unknown>
  return Object.getOwnPropertyNames(proto).flatMap((key) => {
    if (key === 'constructor') return []
    const fn = proto[key]
    if (typeof fn !== 'function') return []
    const parsed = parseKey(key)
    if (!parsed) return []
    return [{
      ...parsed,
      handler: (fn as MockHandler).bind(instance),
      requiresAuth: getAuthEnabled(fn as object) ?? false,
    }]
  })
}

export async function loadMockFile(filePath: string): Promise<LoadedRoute[]> {
  const abs = resolve(filePath)
  try {
    const mod = await import(`${abs}?t=${Date.now()}`)
    const exported = mod.default
    if (!exported) return []
    if (typeof exported === 'function') return fromClass(exported as new () => object)
    if (typeof exported === 'object') return fromObject(exported as Record<string, MockHandler>)
    return []
  } catch (err) {
    console.error(`[mocker] Failed to load ${filePath}:`, err)
    return []
  }
}

export async function scanMockDir(dir: string): Promise<string[]> {
  const abs = resolve(dir)
  try {
    return readdirSync(abs)
      .filter(f => extname(f) === '.ts' && !f.startsWith('_'))
      .map(f => resolve(abs, f))
  } catch {
    console.error(`[mocker] Cannot read mock directory: ${abs}`)
    return []
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
bun test tests/loader.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add core/loader.ts tests/loader.test.ts tests/fixtures/
git commit -m "feat: mock file loader — supports object and class export formats"
```

---

### Task 8: Router + Auth

**Files:**
- Create: `core/router.ts`
- Create: `tests/router.test.ts`

**Interfaces:**
- Consumes: `LoadedRoute`, `MockerConfig`, `MockRequest` from `tools/types.ts`; `createResponse` from `tools/response.ts`; `proxyRequest` from `core/proxy.ts`
- Produces: `buildHonoApp(routes: LoadedRoute[], config: MockerConfig): Hono`

- [ ] **Step 1: Write failing tests**

```ts
// tests/router.test.ts
import { describe, it, expect } from 'bun:test'
import { buildHonoApp } from '../core/router'
import type { LoadedRoute, MockerConfig, MockRequest, MockResponse } from '../tools/types'

const base: MockerConfig = {
  port: 3000, mockDir: './src', fallback: '', enable: true, authToken: '', authValidator: undefined,
}

function route(
  method: string,
  path: string,
  handler: (req: MockRequest, res: MockResponse) => Response | Promise<Response>,
  requiresAuth = false
): LoadedRoute {
  return { method, path, handler, requiresAuth }
}

describe('basic routing', () => {
  it('GET route returns mock response', async () => {
    const app = buildHonoApp([route('GET', '/api/items', (_r, res) => res.resolve([{ id: 1 }]))], base)
    const r = await app.request('/api/items')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([{ id: 1 }])
  })

  it('POST route receives parsed JSON body', async () => {
    const app = buildHonoApp([route('POST', '/api/items', (req, res) => res.resolve(req.body, 201))], base)
    const r = await app.request('/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ name: 'Alice' })
  })

  it('path params are passed in req.params', async () => {
    const app = buildHonoApp([route('GET', '/api/items/:id', (req, res) => res.resolve({ id: req.params.id }))], base)
    const r = await app.request('/api/items/42')
    expect((await r.json() as { id: string }).id).toBe('42')
  })

  it('unmatched route returns 404 JSON when no fallback', async () => {
    const r = await buildHonoApp([], base).request('/api/missing')
    expect(r.status).toBe(404)
    expect(await r.json()).toMatchObject({ error: 'No mock found' })
  })
})

describe('auth', () => {
  it('requiresAuth=true returns 401 without Authorization header', async () => {
    const app = buildHonoApp([route('GET', '/api/secure', (_r, res) => res.resolve({ ok: true }), true)], base)
    expect((await app.request('/api/secure')).status).toBe(401)
  })

  it('requiresAuth=true passes when any Authorization header present (no authToken)', async () => {
    const app = buildHonoApp([route('GET', '/api/secure', (_r, res) => res.resolve({ ok: true }), true)], base)
    const r = await app.request('/api/secure', { headers: { authorization: 'Bearer x' } })
    expect(r.status).toBe(200)
  })

  it('authToken: rejects mismatched token', async () => {
    const cfg = { ...base, authToken: 'secret' }
    const app = buildHonoApp([route('GET', '/api/secure', (_r, res) => res.resolve({ ok: true }), true)], cfg)
    expect((await app.request('/api/secure', { headers: { authorization: 'wrong' } })).status).toBe(401)
    expect((await app.request('/api/secure', { headers: { authorization: 'secret' } })).status).toBe(200)
  })

  it('authValidator: calls function and uses boolean result', async () => {
    const cfg: MockerConfig = { ...base, authValidator: (req) => req.headers['x-admin'] === 'true' }
    const app = buildHonoApp([route('GET', '/api/admin', (_r, res) => res.resolve({ ok: true }), true)], cfg)
    expect((await app.request('/api/admin')).status).toBe(401)
    expect((await app.request('/api/admin', { headers: { 'x-admin': 'true' } })).status).toBe(200)
  })
})

describe('enable=false', () => {
  it('returns 502 when no fallback configured', async () => {
    const app = buildHonoApp([], { ...base, enable: false })
    expect((await app.request('/api/anything')).status).toBe(502)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test tests/router.test.ts
```

Expected: FAIL — `Cannot find module '../core/router'`

- [ ] **Step 3: Implement core/router.ts**

```ts
import { Hono } from 'hono'
import { createResponse } from '../tools/response'
import { proxyRequest } from './proxy'
import type { LoadedRoute, MockerConfig, MockRequest } from '../tools/types'

type HonoMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options'

function checkAuth(req: MockRequest, config: MockerConfig): boolean {
  if (typeof config.authValidator === 'function') {
    return config.authValidator(req)
  }
  const header = req.headers['authorization'] ?? ''
  if (config.authToken) return header === config.authToken
  return header.length > 0
}

export function buildHonoApp(routes: LoadedRoute[], config: MockerConfig): Hono {
  const app = new Hono()

  if (!config.enable) {
    app.all('*', async (c) => {
      if (!config.fallback) {
        return c.json({ error: 'Mock server disabled and no fallback configured' }, 502)
      }
      return proxyRequest(c.req.raw, config.fallback)
    })
    return app
  }

  for (const route of routes) {
    const method = route.method.toLowerCase() as HonoMethod
    app[method](route.path, async (c) => {
      const headers = Object.fromEntries(c.req.raw.headers.entries())

      const mockReq: MockRequest = {
        method: c.req.method,
        path: c.req.path,
        params: c.req.param() as Record<string, string>,
        query: Object.fromEntries(new URL(c.req.url).searchParams.entries()),
        headers,
        body: null,
      }

      if (route.requiresAuth && !checkAuth(mockReq, config)) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      const ct = c.req.header('content-type') ?? ''
      if (ct.includes('application/json')) {
        try { mockReq.body = await c.req.json() } catch { mockReq.body = null }
      } else if (ct.includes('text/')) {
        mockReq.body = await c.req.text()
      }

      return route.handler(mockReq, createResponse())
    })
  }

  app.all('*', async (c) => {
    if (config.fallback) return proxyRequest(c.req.raw, config.fallback)
    return c.json({ error: 'No mock found', path: c.req.path }, 404)
  })

  return app
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test tests/router.test.ts
```

Expected: 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/router.ts tests/router.test.ts
git commit -m "feat: Hono route builder with auth checking and fallback handler"
```

---

### Task 9: File Watcher

**Files:**
- Create: `core/watcher.ts`

**Interfaces:**
- Consumes: `chokidar`
- Produces: `watchMockDir(dir: string, onChange: (filePath: string) => Promise<void>): FSWatcher`

Note: File system events are hard to unit test reliably; correctness is verified in the integration test (Task 10).

- [ ] **Step 1: Implement core/watcher.ts**

```ts
import chokidar, { type FSWatcher } from 'chokidar'
import { resolve } from 'path'

export function watchMockDir(
  dir: string,
  onChange: (filePath: string) => Promise<void>
): FSWatcher {
  const absDir = resolve(dir)

  const notify = (path: string) => {
    console.log(`[mocker] File changed: ${path}`)
    onChange(path).catch(err => console.error('[mocker] Hot reload error:', err))
  }

  return chokidar
    .watch(`${absDir}/**/*.ts`, { ignoreInitial: true, persistent: true })
    .on('change', notify)
    .on('add', notify)
    .on('unlink', notify)
}
```

- [ ] **Step 2: Commit**

```bash
git add core/watcher.ts
git commit -m "feat: chokidar watcher for mock directory hot reload"
```

---

### Task 10: Server Orchestrator

**Files:**
- Create: `core/server.ts`
- Create: `tests/server.test.ts`

**Interfaces:**
- Consumes: `scanMockDir`, `loadMockFile` from `core/loader.ts`; `buildHonoApp` from `core/router.ts`; `watchMockDir` from `core/watcher.ts`; `MockerConfig`, `LoadedRoute` from `tools/types.ts`
- Produces: `startServer(config: MockerConfig): Promise<{ stop(): void }>`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/server.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'path'
import { startServer } from '../core/server'
import type { MockerConfig } from '../tools/types'

const FIXTURES = resolve(import.meta.dir, 'fixtures')

const cfg: MockerConfig = {
  port: 13001, mockDir: FIXTURES, fallback: '', enable: true, authToken: '', authValidator: undefined,
}

let server: { stop(): void } | null = null
afterEach(() => { server?.stop(); server = null })

describe('startServer', () => {
  it('serves routes loaded from mock files', async () => {
    server = await startServer(cfg)
    const r = await fetch('http://localhost:13001/api/items')
    expect(r.status).toBe(200)
    expect(Array.isArray(await r.json())).toBe(true)
  })

  it('returns 404 for unmatched routes when no fallback', async () => {
    server = await startServer(cfg)
    expect((await fetch('http://localhost:13001/api/nonexistent')).status).toBe(404)
  })

  it('returns 401 for auth-protected route without header', async () => {
    server = await startServer(cfg)
    expect((await fetch('http://localhost:13001/api/secure')).status).toBe(401)
  })

  it('returns 200 for auth-protected route with Authorization header', async () => {
    server = await startServer(cfg)
    const r = await fetch('http://localhost:13001/api/secure', {
      headers: { authorization: 'Bearer anything' },
    })
    expect(r.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test tests/server.test.ts
```

Expected: FAIL — `Cannot find module '../core/server'`

- [ ] **Step 3: Implement core/server.ts**

```ts
import { scanMockDir, loadMockFile } from './loader'
import { buildHonoApp } from './router'
import { watchMockDir } from './watcher'
import type { LoadedRoute, MockerConfig } from '../tools/types'

export async function startServer(config: MockerConfig): Promise<{ stop(): void }> {
  const routesByFile = new Map<string, LoadedRoute[]>()

  const files = await scanMockDir(config.mockDir)
  await Promise.all(files.map(async (f) => {
    routesByFile.set(f, await loadMockFile(f))
  }))

  const allRoutes = () => Array.from(routesByFile.values()).flat()

  let app = buildHonoApp(allRoutes(), config)

  const bunServer = Bun.serve({
    port: config.port,
    fetch: (req) => app.fetch(req),
  })

  console.log(`[mocker] Listening on http://localhost:${config.port}`)
  console.log(`[mocker] Mock directory: ${config.mockDir}`)
  if (config.fallback) console.log(`[mocker] Fallback: ${config.fallback}`)
  if (!config.enable) console.log('[mocker] Mock disabled — all requests forwarded')

  const watcher = watchMockDir(config.mockDir, async (changed) => {
    const routes = await loadMockFile(changed)
    if (routes.length > 0) {
      routesByFile.set(changed, routes)
    } else {
      routesByFile.delete(changed)
    }
    app = buildHonoApp(allRoutes(), config)
    bunServer.reload({ fetch: (req) => app.fetch(req) })
    console.log('[mocker] Routes reloaded')
  })

  return { stop() { watcher.close(); bunServer.stop() } }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test tests/server.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/server.ts tests/server.test.ts
git commit -m "feat: server orchestrator with hot reload via Bun.serve.reload"
```

---

### Task 11: CLI Entry Point

**Files:**
- Create: `tools/cli.ts`

**Interfaces:**
- Consumes: `loadConfigFile`, `mergeConfig`, `defaultConfig` from `tools/config.ts`; `startServer` from `core/server.ts`; `MockerConfig` from `tools/types.ts`
- Produces: `mocker` executable (via `bin` in package.json)

- [ ] **Step 1: Implement tools/cli.ts**

```ts
import { parseArgs } from 'util'
import { loadConfigFile, mergeConfig, defaultConfig } from './config'
import { startServer } from '../core/server'
import type { MockerConfig } from './types'

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      port:         { type: 'string' },
      'mock-dir':   { type: 'string' },
      fallback:     { type: 'string' },
      enable:       { type: 'boolean' },
      'auth-token': { type: 'string' },
    },
    strict: false,
  })

  const fileConfig = await loadConfigFile('./mocker.config.ts')

  const cliOverrides: Partial<MockerConfig> = {}
  if (values['port'])              cliOverrides.port = Number(values['port'])
  if (values['mock-dir'])          cliOverrides.mockDir = values['mock-dir'] as string
  if (values['fallback'])          cliOverrides.fallback = values['fallback'] as string
  if (values['enable'] !== undefined) cliOverrides.enable = values['enable'] as boolean
  if (values['auth-token'])        cliOverrides.authToken = values['auth-token'] as string

  const config = mergeConfig(mergeConfig(defaultConfig, fileConfig), cliOverrides)
  await startServer(config)
}

main().catch((err) => {
  console.error('[mocker] Fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Smoke-test the CLI**

```bash
bun run tools/cli.ts --port 4000
```

Expected output:
```
[mocker] Listening on http://localhost:4000
[mocker] Mock directory: ./src
```

Press `Ctrl+C` to stop.

- [ ] **Step 3: Commit**

```bash
git add tools/cli.ts
git commit -m "feat: CLI entry point — parseArgs with CLI > config file > defaults priority"
```

---

### Task 12: Example Mocks + Config

**Files:**
- Create: `mocker.config.ts`
- Create: `data/users.json`
- Create: `src/user.ts`

**Interfaces:**
- Consumes: `auth` from `tools/decorators.ts`; `MockRequest`, `MockResponse` from `tools/types.ts`

- [ ] **Step 1: Create data/users.json**

```json
[
  { "id": 1, "name": "Alice", "email": "alice@example.com" },
  { "id": 2, "name": "Bob",   "email": "bob@example.com" }
]
```

- [ ] **Step 2: Create src/user.ts**

```ts
import { auth } from '../tools/decorators'
import type { MockRequest, MockResponse } from '../tools/types'
import users from '../data/users.json'

export default class UserMock {
  @auth(true)
  ['GET /api/users'](_req: MockRequest, res: MockResponse) {
    return res.resolve(users)
  }

  @auth(true)
  ['POST /api/users'](req: MockRequest, res: MockResponse) {
    return res.resolve({ id: Date.now(), ...(req.body as object) }, 201)
  }

  @auth(false)
  ['GET /api/users/:id'](req: MockRequest, res: MockResponse) {
    const user = users.find(u => u.id === Number(req.params.id))
    return user ? res.resolve(user) : res.reject('Not found', 404)
  }

  @auth(false)
  ['DELETE /api/users/:id'](_req: MockRequest, res: MockResponse) {
    return res.resolve(null, 204)
  }
}
```

- [ ] **Step 3: Create mocker.config.ts**

```ts
import type { MockerConfig } from './tools/types'

export default {
  port: 3000,
  mockDir: './src',
  fallback: '',
  enable: true,
  authToken: '',
  authValidator: undefined,
} satisfies Partial<MockerConfig>
```

- [ ] **Step 4: Run full test suite**

```bash
bun test
```

Expected: all tests PASS, no failures.

- [ ] **Step 5: Manual smoke test**

```bash
bun run tools/cli.ts
```

In a second terminal:

```bash
# Expect 401 — route requires auth
curl -i http://localhost:3000/api/users

# Expect 200 with user list
curl -i http://localhost:3000/api/users -H "Authorization: Bearer any"

# Expect 200 — no auth required
curl -i http://localhost:3000/api/users/1

# Expect 404
curl -i http://localhost:3000/api/users/99
```

- [ ] **Step 6: Commit**

```bash
git add mocker.config.ts data/users.json src/user.ts
git commit -m "feat: example mock file and default config"
```
