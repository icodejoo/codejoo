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
