export interface MockRequest {
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
  headers: Record<string, string>
  method: string
  path: string
}

export interface MockResponse {
  resolve: {
    <T>(data: T, code?: number): Response
    delay<T>(data: T, ms?: number, code?: number): Promise<Response>
  }
  reject: {
    (message: string, code?: number): Response
    delay(message: string, ms?: number, code?: number): Promise<Response>
  }
}

export class MockError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
  ) {
    super(message)
    this.name = 'MockError'
  }
}

export type MockHandler = (req: MockRequest, res: MockResponse) => unknown

export interface LoadedRoute {
  method: string
  path: string
  handler: MockHandler
  requiresAuth: boolean
}

export type ProxyTarget =
  | string
  | { target: string; rewrite?: (path: string) => string }

// ── Extension types ───────────────────────────────────────────────────────────

export interface NetworkConfig {
  /** Fixed ms or random range. Applied only to mock-handled responses. */
  latency?: number | { min: number; max: number }
  /** 0–1 probability of injecting a 500 response. */
  errorRate?: number
}

export interface HookConfig {
  /** Called after body is parsed, before the mock handler runs. */
  onRequest?: (req: MockRequest) => void | Promise<void>
  /** Called after response is built and network simulation applied. */
  onResponse?: (req: MockRequest, res: Response, duration: number) => void | Promise<void>
  /** Called after a proxy response arrives. Return a new Response to replace it. */
  onProxyResponse?: (req: MockRequest, res: Response) => Response | void | Promise<Response | void>
}

export interface HistoryEntry {
  id: number
  timestamp: string
  method: string
  path: string
  query: Record<string, string>
  body: unknown
  status: number
  duration: number
  source: 'mock' | 'proxy'
}

// ── Main config ───────────────────────────────────────────────────────────────

export interface MockerConfig {
  port: number
  dir: string
  /** Single catch-all fallback. Superseded by `proxy` when both are set. */
  fallback: string
  /** Path-prefix → target map. Longer prefix wins. Supersedes `fallback`. */
  proxy: Record<string, ProxyTarget>
  /**
   * true  (default) — mock first: hit mock → on miss, forward to proxy/fallback
   * false           — proxy first: forward first → on 404, fall back to mock
   */
  priority?: boolean
  enable: boolean
  authToken: string
  authValidator: ((req: MockRequest) => boolean) | undefined
  network?: NetworkConfig
  hooks?: HookConfig
}
