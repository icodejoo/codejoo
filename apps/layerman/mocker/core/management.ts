import { Hono } from 'hono'
import { getScenario, setScenario, resetScenario } from './scenario'
import { query, clearHistory } from './history'

// Mounted at /_mock — all paths here are relative to that prefix.
export function buildManagementApp(): Hono {
  const app = new Hono()

  // GET /_mock/status
  app.get('/status', (c) => c.json({
    scenario: getScenario(),
    historySize: query().length,
  }))

  // GET /_mock/scenario
  app.get('/scenario', (c) => c.json({ scenario: getScenario() }))

  // POST /_mock/scenario   body: { name: string | null }
  app.post('/scenario', async (c) => {
    const { name } = await c.req.json() as { name?: string | null }
    setScenario(name ?? null)
    return c.json({ scenario: getScenario() })
  })

  // DELETE /_mock/scenario  — clear active scenario
  app.delete('/scenario', (c) => {
    resetScenario()
    return c.json({ scenario: null })
  })

  // GET /_mock/history?path=&method=&limit=
  app.get('/history', (c) => {
    const q = c.req.query()
    return c.json(query({
      path:   q.path,
      method: q.method,
      limit:  q.limit ? Number(q.limit) : undefined,
    }))
  })

  // DELETE /_mock/history
  app.delete('/history', (c) => { clearHistory(); return c.json({ cleared: true }) })

  // POST /_mock/reset  — scenario + history
  app.post('/reset', (c) => {
    resetScenario()
    clearHistory()
    return c.json({ ok: true })
  })

  return app
}
