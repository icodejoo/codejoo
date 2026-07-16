import { Hono } from 'hono'
import { createResponse } from '../tools/response'
import { proxyRequest } from './proxy'
import { buildManagementApp } from './management'
import { record } from './history'
import { MockError } from '../tools/types'
import type { LoadedRoute, MockerConfig, MockRequest, NetworkConfig, ProxyTarget } from '../tools/types'

type HonoMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options'

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req: MockRequest, config: MockerConfig): boolean {
  if (typeof config.authValidator === 'function') return config.authValidator(req)
  const header = req.headers['authorization'] ?? ''
  if (config.authToken) return header === config.authToken
  return header.length > 0
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

function matchProxy(path: string, proxy: Record<string, ProxyTarget> | undefined): ProxyTarget | null {
  const sorted = Object.entries(proxy ?? {}).sort((a, b) => b[0].length - a[0].length)
  for (const [prefix, rule] of sorted) {
    if (path.startsWith(prefix)) return rule
  }
  return null
}

function applyProxy(req: Request, path: string, rule: ProxyTarget): Promise<Response> {
  const target = typeof rule === 'string' ? rule : rule.target
  const rewrite = typeof rule === 'object' ? rule.rewrite : undefined
  return proxyRequest(req, target, rewrite ? rewrite(path) : undefined)
}

// ── Network simulation ────────────────────────────────────────────────────────

async function applyNetwork(net: NetworkConfig | undefined, res: Response): Promise<Response> {
  if (!net) return res
  if (net.errorRate && Math.random() < net.errorRate) {
    return Response.json({ error: 'Simulated network error' }, { status: 500 })
  }
  if (net.latency) {
    const ms = typeof net.latency === 'number'
      ? net.latency
      : net.latency.min + Math.random() * (net.latency.max - net.latency.min)
    await new Promise(r => setTimeout(r, ms))
  }
  return res
}

// ── Route registration ────────────────────────────────────────────────────────

function registerRoutes(app: Hono, routes: LoadedRoute[], config: MockerConfig): void {
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

      await config.hooks?.onRequest?.(mockReq)

      const t = Date.now()
      let response: Response
      try {
        const result = await route.handler(mockReq, createResponse())
        response = result instanceof Response
          ? result
          : Response.json(result ?? null, { status: 200 })
      } catch (err) {
        const status = err instanceof MockError ? err.status : 500
        const message = err instanceof Error ? err.message : String(err)
        response = Response.json({ error: message }, { status })
      }
      response = await applyNetwork(config.network, response)
      const duration = Date.now() - t

      await config.hooks?.onResponse?.(mockReq, response, duration)
      record({ method: mockReq.method, path: mockReq.path, query: mockReq.query, body: mockReq.body, status: response.status, duration, source: 'mock' })

      return response
    })
  }
}

// ── Proxy catch-all helper ────────────────────────────────────────────────────

function buildProxyCatchall(config: MockerConfig): Parameters<Hono['all']>[1] {
  return async (c) => {
    const path = c.req.path
    const headers = Object.fromEntries(c.req.raw.headers.entries())
    const mockReq: MockRequest = {
      method: c.req.method, path, params: {}, headers,
      query: Object.fromEntries(new URL(c.req.url).searchParams.entries()),
      body: null,
    }

    const rule = matchProxy(path, config.proxy)
    const t = Date.now()
    let response: Response

    if (rule) {
      response = await applyProxy(c.req.raw, path, rule)
    } else if (config.fallback) {
      response = await proxyRequest(c.req.raw, config.fallback)
    } else {
      return c.json({ error: 'No mock found', path }, 404, { 'x-mocker-miss': '1' })
    }

    const modified = await config.hooks?.onProxyResponse?.(mockReq, response)
    if (modified instanceof Response) response = modified
    record({ method: c.req.method, path, query: mockReq.query, body: null, status: response.status, duration: Date.now() - t, source: 'proxy' })
    return response
  }
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildHonoApp(routes: LoadedRoute[], config: MockerConfig): Hono {
  const app = new Hono()

  // Management routes always active — before everything else
  app.route('/_mock', buildManagementApp())

  if (!config.enable) {
    app.all('*', async (c) => {
      const rule = matchProxy(c.req.path, config.proxy)
      if (rule) return applyProxy(c.req.raw, c.req.path, rule)
      if (config.fallback) return proxyRequest(c.req.raw, config.fallback)
      return c.json({ error: 'Mock server disabled and no proxy configured' }, 502)
    })
    return app
  }

  if (config.priority !== false) {
    // ── Mock first (default) ────────────────────────────────────────────────
    registerRoutes(app, routes, config)
    app.all('*', buildProxyCatchall(config))
  } else {
    // ── Proxy first ─────────────────────────────────────────────────────────
    // Body buffered up-front so proxy attempt and mock fallback can both read it.
    const mockOnlyApp = new Hono()
    registerRoutes(mockOnlyApp, routes, config)
    mockOnlyApp.all('*', (c) =>
      c.json({ error: 'No mock found', path: c.req.path }, 404, { 'x-mocker-miss': '1' })
    )

    app.all('*', async (c) => {
      const path = c.req.path
      const rule = matchProxy(path, config.proxy)

      if (rule || config.fallback) {
        const bodyBuf = await c.req.arrayBuffer()
        const makeReq = () => new Request(c.req.url, {
          method: c.req.method,
          headers: new Headers(c.req.raw.headers),
          body: bodyBuf.byteLength ? bodyBuf : undefined,
        })

        const mockReq: MockRequest = {
          method: c.req.method, path, params: {},
          query: Object.fromEntries(new URL(c.req.url).searchParams.entries()),
          headers: Object.fromEntries(c.req.raw.headers.entries()),
          body: null,
        }

        const t = Date.now()
        let proxyResp = rule
          ? await applyProxy(makeReq(), path, rule)
          : await proxyRequest(makeReq(), config.fallback)

        if (proxyResp.status !== 404) {
          const modified = await config.hooks?.onProxyResponse?.(mockReq, proxyResp)
          if (modified instanceof Response) proxyResp = modified
          record({ method: c.req.method, path, query: mockReq.query, body: null, status: proxyResp.status, duration: Date.now() - t, source: 'proxy' })
          return proxyResp
        }

        // Proxy 404 → try mock
        const mockResp = await mockOnlyApp.fetch(makeReq())
        if (!mockResp.headers.get('x-mocker-miss')) return mockResp
        return c.json({ error: 'No mock found', path }, 404)
      }

      // No proxy — try mock, fall through on miss (Vite passthrough)
      return mockOnlyApp.fetch(c.req.raw)
    })
  }

  return app
}
