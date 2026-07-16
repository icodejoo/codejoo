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

  it('resolve.delay resolves after delay', async () => {
    const start = Date.now()
    const r = await createResponse().resolve.delay({ ok: true }, 100)
    expect(Date.now() - start).toBeGreaterThanOrEqual(90)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('resolve.delay with ms=0 works as resolve', async () => {
    const r = await createResponse().resolve.delay({ ok: true }, 0)
    expect(r.status).toBe(200)
  })

  it('reject.delay rejects after delay with correct status', async () => {
    const r = await createResponse().reject.delay('timeout', 100, 503)
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'timeout' })
  })
})
