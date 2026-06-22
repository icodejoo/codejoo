import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/**
 * 真实感网络仿真：可作为 axios `adapter` 装进真实实例，配合 `create()` + 插件栈跑集成测试。
 *
 *   - **乱序返回**：每个请求按 `config.latency`（毫秒，默认 0）经 `setTimeout` 完成 ——
 *     给不同请求设不同延迟即可制造"后发先至"。
 *   - **错误注入**：路由 handler 返回非 2xx 状态（或 `transient` 计数）即模拟 HTTP 错误；
 *     本适配器**自行套用 `validateStatus`**（自定义 adapter 不会被 axios 自动套用），
 *     非 2xx → reject 一个带 `.response` 的 AxiosError，与真实 xhr/http adapter 行为一致。
 *   - **有状态后端**：handler 收到 `(config, hit)`，可读 header / 维护 token 等状态。
 *   - **可观测**：`calls(method,url)` 调用次数、`log` 全量调用流水（含 header 与完成顺序）。
 */

export interface RouteResult {
  status?: number;
  data?: unknown;
  headers?: Record<string, unknown>;
}

export type RouteHandler = (
  config: InternalAxiosRequestConfig,
  hit: number,
) => RouteResult | void;

export interface CallRecord {
  method: string;
  url: string;
  auth?: unknown;
  startedAt: number;
  finishedAt?: number;
}

function keyOf(method: string | undefined, url: string | undefined): string {
  return `${(method || 'get').toUpperCase()} ${url ?? ''}`;
}

function headerGet(config: InternalAxiosRequestConfig, name: string): unknown {
  const h = config.headers as unknown;
  if (!h) return undefined;
  if (typeof (h as { get?: unknown }).get === 'function') return (h as { get(n: string): unknown }).get(name);
  const rec = h as Record<string, unknown>;
  return rec[name] ?? rec[name.toLowerCase()];
}

export function makeNetwork() {
  const routes = new Map<string, RouteHandler>();
  const counts = new Map<string, number>();
  const log: CallRecord[] = [];
  let seq = 0;
  let started = 0;
  let finished = 0;
  let fallback: RouteHandler = () => ({ status: 200, data: { code: 0, data: null } });

  const adapter: AxiosAdapter = (config) =>
    new Promise<AxiosResponse>((resolve, reject) => {
      const k = keyOf(config.method, config.url);
      const hit = (counts.get(k) ?? 0) + 1;
      counts.set(k, hit);
      started++;
      const rec: CallRecord = {
        method: (config.method || 'get').toUpperCase(),
        url: config.url ?? '',
        auth: headerGet(config, 'Authorization'),
        startedAt: ++seq,
      };
      log.push(rec);

      const latency = (config as { latency?: number }).latency ?? 0;
      setTimeout(() => {
        rec.finishedAt = ++seq;
        finished++;
        let out: RouteResult | void;
        try {
          const handler = routes.get(k) ?? routes.get(config.url ?? '') ?? fallback;
          out = handler(config, hit);
        } catch (e) {
          return reject(e);
        }
        const status = out?.status ?? 200;
        const response = {
          status,
          statusText: '',
          headers: out?.headers ?? {},
          config,
          data: out && 'data' in out ? out.data : { code: 0, data: null },
          request: {},
        } as AxiosResponse;

        const validate = config.validateStatus;
        const okStatus = validate ? validate(status) : status >= 200 && status < 300;
        if (okStatus) return resolve(response);
        const err = new Error(`Request failed with status code ${status}`) as Error & {
          config?: unknown; response?: unknown; status?: number; isAxiosError?: boolean;
        };
        err.config = config; err.response = response; err.status = status; err.isAxiosError = true;
        reject(err);
      }, latency);
    });

  return {
    adapter,
    /** 注册 method+url 路由 handler。 */
    on(method: string, url: string, handler: RouteHandler) {
      routes.set(keyOf(method, url), handler);
      return this;
    },
    /** 默认 handler（未命中路由时）。 */
    fallback(handler: RouteHandler) {
      fallback = handler;
      return this;
    },
    /** 某 method+url 的累计调用次数。 */
    calls(method: string, url: string): number {
      return counts.get(keyOf(method, url)) ?? 0;
    },
    /** 总发起 / 总完成数。 */
    get totalStarted() { return started; },
    get totalFinished() { return finished; },
    log,
  };
}
