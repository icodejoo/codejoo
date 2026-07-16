import { describe, it, expect } from 'bun:test'
import { buildHonoApp } from '../core/router'
import { MockError } from '../tools/types'
import type { LoadedRoute, MockerConfig, MockRequest, MockResponse } from '../tools/types'

const base: MockerConfig = {
  port: 3000, dir: './src', fallback: '', proxy: {}, enable: true, authToken: '', authValidator: undefined,
}

function route(
  method: string,
  path: string,
  handler: (req: MockRequest, res: MockResponse) => unknown,
  requiresAuth = false
): LoadedRoute {
  return { method, path, handler: handler as LoadedRoute['handler'], requiresAuth }
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

describe('auto-wrap returns', () => {
  it('plain object return → 200 JSON', async () => {
    const app = buildHonoApp([route('GET', '/api/x', () => ({ hello: 'world' }))], base)
    const r = await app.request('/api/x')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ hello: 'world' })
  })

  it('string return → 200 JSON string', async () => {
    const app = buildHonoApp([route('GET', '/api/x', () => 'hello')], base)
    const r = await app.request('/api/x')
    expect(r.status).toBe(200)
    expect(await r.json()).toBe('hello')
  })

  it('undefined return → 200 null body', async () => {
    const app = buildHonoApp([route('GET', '/api/x', () => undefined)], base)
    const r = await app.request('/api/x')
    expect(r.status).toBe(200)
    expect(await r.json()).toBeNull()
  })

  it('existing Response return still passes through unchanged', async () => {
    const app = buildHonoApp([route('GET', '/api/x', (_r, res) => res.resolve({ ok: true }, 201))], base)
    const r = await app.request('/api/x')
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('throw Error → 500 with error message', async () => {
    const app = buildHonoApp([route('GET', '/api/x', () => { throw new Error('broken') })], base)
    const r = await app.request('/api/x')
    expect(r.status).toBe(500)
    expect(await r.json()).toMatchObject({ error: 'broken' })
  })

  it('throw MockError → custom status code', async () => {
    const app = buildHonoApp([route('GET', '/api/x', () => { throw new MockError('not here', 404) })], base)
    const r = await app.request('/api/x')
    expect(r.status).toBe(404)
    expect(await r.json()).toMatchObject({ error: 'not here' })
  })

  it('throw MockError with default status → 500', async () => {
    const app = buildHonoApp([route('GET', '/api/x', () => { throw new MockError('oops') })], base)
    const r = await app.request('/api/x')
    expect(r.status).toBe(500)
    expect(await r.json()).toMatchObject({ error: 'oops' })
  })
})
