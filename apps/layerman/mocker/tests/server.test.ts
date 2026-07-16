import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'path'
import { startServer } from '../core/server'
import type { MockerConfig } from '../tools/types'

const FIXTURES = resolve(import.meta.dir, 'fixtures')

const cfg: MockerConfig = {
  port: 13001, dir: FIXTURES, fallback: '', proxy: {}, enable: true, authToken: '', authValidator: undefined,
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
