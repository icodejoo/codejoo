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

describe('loadMockFile — baseUrl', () => {
  it('prepends baseUrl to every route path', async () => {
    const routes = await loadMockFile(`${FIXTURES}/baseurl-mock.ts`)
    expect(routes).toHaveLength(2)
    expect(routes.every(r => r.path.startsWith('/api/'))).toBe(true)
  })

  it('GET route resolves to /api/things', async () => {
    const routes = await loadMockFile(`${FIXTURES}/baseurl-mock.ts`)
    const get = routes.find(r => r.method === 'GET')!
    expect(get.path).toBe('/api/things')
    expect(get.requiresAuth).toBe(false)
  })

  it('@auth (no parens) on POST yields requiresAuth=true', async () => {
    const routes = await loadMockFile(`${FIXTURES}/baseurl-mock.ts`)
    const post = routes.find(r => r.method === 'POST')!
    expect(post.path).toBe('/api/things')
    expect(post.requiresAuth).toBe(true)
  })
})

describe('scanMockDir', () => {
  it('returns .ts files from the directory', async () => {
    const files = await scanMockDir(FIXTURES)
    expect(files.some(f => f.endsWith('object-mock.ts'))).toBe(true)
    expect(files.some(f => f.endsWith('class-mock.ts'))).toBe(true)
  })
})
