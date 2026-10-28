import axios, { AxiosError } from 'axios';
import type { AxiosInstance, AxiosResponse } from 'axios';
import {
  ACCESS_DENIED_CODE,
  Axp,
  AxpResponse,
  authFailureFactory,
  axpAuth,
  axpCache,
  axpCancel,
  axpEnvs,
  axpFilter,
  axpKey,
  axpLoading,
  axpLogger,
  axpMock,
  axpNormalize,
  axpNotify,
  axpRepath,
  axpRetry,
  axpShare,
  cancelAll,
  clearCache,
} from '@codejoo/axp';
import type { AxpPlugins } from '@codejoo/axp';
import { classifyError, PARSE_MARK } from './classify.ts';
import { HEADER_RUN, HEADER_STYLE, MOCK_PREFIX, DEFAULT_RETRY_METHODS, DEFAULT_RETRY_STATUSES, DEFAULT_CACHE_METHODS } from './constants.ts';
import type { AdapterName, Style } from './constants.ts';
import { authUrlPatterns, effectiveRetryStatuses, lowerMethods, mapRequestOptions } from './mapping.ts';
import type { TokenStore } from './tokens.ts';
import type { PluginConfigs, RequestSpec } from './types.ts';

/** 被测客户端向执行器上报事件用的回调集合 */
export interface ClientHooks {
  loading(visible: boolean): void;
  notify(message: string): void;
  /** 实际发起了一次刷新调用 */
  refresh(): void;
  expired(reqTag: string | undefined): void;
  /** 请求自身的 authExpired 标记（回调一轮只触发一次，其余请求靠标记归类） */
  expiredMarked(reqTag: string | undefined): void;
  denied(reqTag: string | undefined): void;
  unauthenticated(reqTag: string | undefined): void;
}

/** createClient 的参数 */
export interface ClientOptions {
  adapter: AdapterName;
  baseURL: string;
  /** 客户端默认请求超时 */
  baseTimeoutMs?: number;
  /** 场景的中立插件配置 */
  plugins: PluginConfigs | undefined;
  tokens: TokenStore;
  hooks: ClientHooks;
  /** 当前响应风格（刷新请求与公共请求头用，随 style step 变化） */
  getStyle: () => Style;
  /** 本次运行的 X-Test-Run */
  runId: string;
}

/** 单次发送的附加信息 */
export interface SendExtra {
  /** 请求标签，auth 回调据此给请求打 expired/denied 标记 */
  tkReq: string;
  /** 外部提供的取消信号（cancel_after_ms 用） */
  signal?: AbortSignal;
}

/** 被测客户端句柄 */
export interface ClientHandle {
  axios: AxiosInstance;
  /** 通过 axp 发请求，返回客户端最终拿到的数据（信封已解包） */
  send(spec: RequestSpec, extra: SendExtra): Promise<unknown>;
  cancelAll(): number;
  clearCache(): number;
  /** 切换 baseURL（network step 切到 dns 时用；已装的 mock 基址不随之变化） */
  setBaseURL(url: string): void;
  dispose(): void;
}

/** 带 body 的方法 */
const BODY_METHODS = new Set(['post', 'put', 'patch', 'delete']);
/** 刷新接口路径 */
const REFRESH_PATH = '/t/auth/refresh';
/** 业务失败也以 HTTP 200 送达，retry 读取 Retry-After 时需要把 200 也算进去 */
const RETRY_AFTER_STATUSES = [200, 413, 429, 503];

/** 读取请求标签 */
function reqTagOf(config: unknown): string | undefined {
  const t = (config as { tkReq?: unknown } | undefined)?.tkReq;
  return typeof t === 'string' ? t : undefined;
}

/** 响应体 envelope 的 code */
function bodyCode(data: unknown): unknown {
  return data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
}

/**
 * 逻辑状态：HTTP 状态码 ≥ 400 就是它自己；HTTP 2xx 且信封 code 是非 0 数字时取 code（business 风格）；否则是 HTTP 状态码。
 * @param status HTTP 状态码
 * @param data 响应体
 * @example logicalStatus(200, { code: 401 }) // 401
 */
export function logicalStatus(status: number, data: unknown): number {
  const code = bodyCode(data);
  if (status >= 200 && status < 300 && typeof code === 'number' && code !== 0) return code;
  return status;
}

/**
 * 读取 401 响应里 `data.reason`（两种风格都在信封的 data 里）。
 * @param body 响应体
 */
export function reasonOf(body: unknown): string | undefined {
  const d = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
  const r = d && typeof d === 'object' ? (d as { reason?: unknown }).reason : undefined;
  return typeof r === 'string' ? r : undefined;
}

/**
 * 构造 auth 的 onFailure：按 CONTRACT §4.2 处理鉴权失败，http 与 business 两种风格都识别。
 * - 逻辑状态 403 → deny；
 * - 逻辑状态 401：`reason=missing` 且没有 refresh → 不刷新，标记 unauthenticated；其余沿用 axp 默认的 refresh/replay 决策；
 * - 其它 → others。
 * @param tm 令牌存储
 * @param hooks 事件回调
 * @returns 可传给 axpAuth 的 onFailure
 */
export function makeOnFailure(tm: TokenStore, hooks: ClientHooks) {
  const base = authFailureFactory();
  return (_tm: unknown, resp: AxiosResponse): string => {
    const logical = logicalStatus(resp.status, resp.data);
    if (logical === 403) return 'deny';
    if (logical !== 401) return 'others';
    if (reasonOf(resp.data) === 'missing' && !tm.refreshToken) {
      hooks.unauthenticated(reqTagOf(resp.config));
      return 'others';
    }
    return base(tm, { status: 401, config: resp.config });
  };
}

/**
 * 构造 retry 的 shouldRetry：用逻辑状态判断（business 风格的 HTTP 200 + code=500 也会重试），
 * 没有响应的错误里只有网络错误与超时可重试，取消、解析、鉴权本地错误不重试。
 * 方法白名单由 retry 插件自己先行过滤。
 * @param defaultStatuses 插件级可重试状态
 */
export function makeShouldRetry(defaultStatuses: number[]) {
  return (response?: AxiosResponse, err?: AxiosError): boolean => {
    const cfg = (response?.config ?? err?.config) as { retry?: unknown } | undefined;
    const reqLevel = cfg && typeof cfg.retry === 'object' && cfg.retry ? (cfg.retry as { statusCodes?: number[] }).statusCodes : undefined;
    const statuses = effectiveRetryStatuses(reqLevel, defaultStatuses);
    if (response) return statuses.includes(logicalStatus(response.status, response.data));
    if (err?.response) return statuses.includes(err.response.status);
    const kind = classifyError(err);
    return kind === 'network' || kind === 'timeout';
  };
}

/**
 * 构造 notify 的 stringify：返回空串表示不提示。
 * 不提示：请求标了 silent、用户主动取消（signal 已中止）、成功（HTTP 2xx 且信封 code 为 0 或无信封）。
 * @param data 响应体
 * @param message 错误消息
 * @param status HTTP 状态码，无响应为 0
 * @param config 请求配置
 */
export function notifyText(data: unknown, message: string, status: number, config: unknown): string {
  const cfg = config as { silent?: boolean; signal?: { aborted?: boolean } } | undefined;
  if (cfg?.silent === true || cfg?.signal?.aborted === true) return '';
  if (!status) return message || 'request failed';
  const code = bodyCode(data);
  if (status >= 400) return message || `HTTP ${status}`;
  if (typeof code === 'number' && code !== 0) return message || `code ${code}`;
  return '';
}

/**
 * cache 的 shouldCache：默认判定与 axp 一致（业务成功才缓存），再叠加方法白名单。
 * @param methods 允许缓存的方法（大写）
 */
export function makeShouldCache(methods: string[]) {
  const allow = new Set(methods.map((m) => m.toUpperCase()));
  return (res: AxiosResponse): boolean => {
    if (!allow.has(String(res.config?.method ?? 'get').toUpperCase())) return false;
    let body: unknown = res.data;
    if (typeof body === 'string' && body.trim().startsWith('{')) {
      try { body = JSON.parse(body); } catch { /* 非 JSON 当普通文本 */ }
    }
    return AxpResponse.fromResponse({ status: res.status, data: body }).successful;
  };
}

/**
 * 响应体校验（transformResponse 末尾一环）：服务端声明了 JSON 或 HTML 的 2xx 响应，
 * 如果 body 仍是非空字符串，说明解析失败（bad_json）或拿到了网关拦截页（html），按解析错误抛出，
 * 让整条插件链（notify/loading/retry）都能看到这是一次失败。HTTP ≥ 400 交给状态码判定，不在这里处理。
 * @param this axios 请求配置
 * @param data 已经过默认转换的 body
 * @param headers 响应头
 * @param status HTTP 状态码
 */
export function parseGuard(this: unknown, data: unknown, headers: unknown, status?: number): unknown {
  if (typeof status === 'number' && status >= 400) return data;
  if (typeof data !== 'string' || data.trim() === '') return data;
  const h = headers as { get?: (k: string) => unknown; [k: string]: unknown } | undefined;
  const ct = String((typeof h?.get === 'function' ? h.get('content-type') : h?.['content-type']) ?? '');
  if (!/json|html/i.test(ct)) return data;
  const err = new AxiosError('response body is not valid JSON', AxiosError.ERR_BAD_RESPONSE, this as never);
  (err as unknown as Record<string, unknown>)[PARSE_MARK] = true;
  throw err;
}

/** 构造 auth 插件 */
function buildAuth(opts: ClientOptions, cfg: Record<string, unknown>, getBase: () => string) {
  const { tokens, hooks } = opts;
  const refreshQuery = (cfg.refresh_query ?? undefined) as Record<string, unknown> | undefined;
  const bare = axios.create({ adapter: opts.adapter, timeout: opts.baseTimeoutMs, validateStatus: () => true });
  return axpAuth({
    tokenManager: tokens,
    urlPattern: authUrlPatterns(cfg.url_pattern as string | undefined),
    onFailure: makeOnFailure(tokens, hooks) as never,
    onRefresh: async () => {
      const refresh = tokens.refreshToken;
      if (!refresh) return false;
      hooks.refresh();
      try {
        const res = await bare.post(REFRESH_PATH, { refresh_token: refresh }, {
          baseURL: getBase(),
          params: refreshQuery,
          headers: { [HEADER_RUN]: opts.runId, [HEADER_STYLE]: opts.getStyle() },
        });
        const body = res.data as { code?: unknown; data?: { access_token?: string; refresh_token?: string } } | undefined;
        if (body?.code !== 0 || !body.data?.access_token) return false;
        tokens.set(body.data.access_token, body.data.refresh_token);
        return true;
      } catch {
        return false;
      }
    },
    onAccessExpired: (_tm, resp) => hooks.expired(reqTagOf(resp.config)),
    onAccessDenied: (_tm, resp) => {
      const synthetic = resp.status === 0 && bodyCode(resp.data) === ACCESS_DENIED_CODE;
      if (synthetic) hooks.unauthenticated(reqTagOf(resp.config));
      else hooks.denied(reqTagOf(resp.config));
    },
  });
}

/**
 * 按场景的中立插件配置组装 axp 实例（经 Axp.install 以规范顺序装配），并返回操作句柄。
 * 被测对象是 dist/esm 的打包产物（由 vitest alias / 包名自引用指向）。
 * @param opts 客户端参数
 * @returns 客户端句柄
 * @throws 映射不了的配置在 plan 阶段已由 validateScenarioMapping 拦截，这里不重复校验
 */
export function createClient(opts: ClientOptions): ClientHandle {
  let baseURL = opts.baseURL;
  const instance = axios.create({ adapter: opts.adapter, baseURL, timeout: opts.baseTimeoutMs });
  const prev = ([] as unknown[]).concat(instance.defaults.transformResponse ?? []);
  instance.defaults.transformResponse = [...prev, parseGuard] as never;
  const core = Axp.create(instance);

  const p = opts.plugins ?? {};
  const slots: AxpPlugins = {};
  if (p.log) slots.logger = axpLogger({});
  if (p.envs) slots.envs = axpEnvs([]);
  if (p.auth) slots.auth = buildAuth(opts, p.auth, () => baseURL);
  if (p.key) {
    const scope = (p.key as { scope?: string }).scope;
    slots.key = axpKey(scope === 'user' ? { scope: () => opts.tokens.user } : {});
  }
  if (p.filter) slots.filter = axpFilter({});
  if (p.repath) slots.repath = axpRepath({});
  if (p.retry) {
    const r = p.retry as { max?: number; delay_ms?: number; statuses?: number[]; methods?: string[]; respect_retry_after?: boolean };
    const statuses = r.statuses ?? [...DEFAULT_RETRY_STATUSES];
    slots.retry = axpRetry({
      max: r.max ?? 0,
      delay: r.delay_ms,
      statusCodes: statuses,
      methods: lowerMethods(r.methods ?? [...DEFAULT_RETRY_METHODS]),
      respectRetryAfter: r.respect_retry_after,
      afterStatusCodes: RETRY_AFTER_STATUSES,
      shouldRetry: makeShouldRetry(statuses),
    });
  }
  if (p.cancel) slots.cancel = axpCancel({});
  if (p.notify) slots.notify = axpNotify({ notify: opts.hooks.notify, stringify: notifyText as never });
  if (p.normalize) slots.normalize = axpNormalize({});
  if (p.cache) {
    const c = p.cache as { ttl_ms?: number; max?: number; methods?: string[] };
    slots.cache = axpCache({
      expires: c.ttl_ms,
      max: c.max,
      shouldCache: makeShouldCache(c.methods ?? [...DEFAULT_CACHE_METHODS]),
    });
  }
  if (p.share) slots.share = axpShare({ policy: (p.share as { policy?: 'start' | 'end' | 'race' }).policy });
  if (p.mock) {
    const fb = (p.mock as { fallback_on_404?: boolean }).fallback_on_404;
    slots.mock = axpMock({
      enable: true,
      mockUrl: `${opts.baseURL}${MOCK_PREFIX}`,
      fallbackWhen: fb === false ? () => false : undefined,
    });
  }
  if (p.loading) {
    const l = p.loading as { delay_ms?: number; delay_close_ms?: number };
    slots.loading = axpLoading({ loading: opts.hooks.loading, delay: l.delay_ms, delayClose: l.delay_close_ms });
  }
  const handle = Axp.install(instance, slots);
  // 在 auth 之后观察结果：config 上有 authExpired 的请求（含 business 风格被 resolve 的失败响应）打 expired 标签
  instance.interceptors.response.use(
    (res) => {
      if (res.config?.authExpired) opts.hooks.expiredMarked(reqTagOf(res.config));
      return res;
    },
    (err: { config?: unknown }) => {
      if ((err?.config as { authExpired?: boolean } | undefined)?.authExpired) opts.hooks.expiredMarked(reqTagOf(err.config));
      return Promise.reject(err);
    },
  );

  return {
    axios: instance,
    send(spec, extra) {
      const method = (spec.method ?? 'GET').toLowerCase();
      const config: Record<string, unknown> = {
        params: spec.query,
        headers: { [HEADER_RUN]: opts.runId, [HEADER_STYLE]: opts.getStyle(), ...spec.headers },
        tkReq: extra.tkReq,
        ...mapRequestOptions(spec.options),
      };
      if (extra.signal) config.signal = extra.signal;
      const payload = BODY_METHODS.has(method) ? spec.body : undefined;
      const verb = (core as unknown as Record<string, (path: string) => (payload: unknown, cfg: unknown) => Promise<unknown>>)[method];
      return verb.call(core, spec.path)(payload, config);
    },
    cancelAll: () => cancelAll(instance),
    clearCache: () => clearCache(instance),
    setBaseURL(url) {
      baseURL = url;
      instance.defaults.baseURL = url;
    },
    dispose: () => handle.dispose(),
  };
}
