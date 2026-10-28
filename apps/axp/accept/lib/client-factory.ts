import axios from "axios";
import type { AxiosInstance } from "axios";
import { AXP_KINDS, axpAuth, axpCache, axpEnvs, axpFilter, axpLoading, axpMock, axpNotify, axpRepath, axpResponse, axpRetry, axpShare, clearCache, createAxp } from "@codejoo/axp";
import type { AxpPlugin, AxpRequestConfig, AxpResponse } from "@codejoo/axp";
import { HEADER_RUN, HEADER_STYLE, MOCK_PREFIX, DEFAULT_RETRY_METHODS, DEFAULT_RETRY_STATUSES } from "./constants.ts";
import type { AdapterName, Style } from "./constants.ts";
import { authUrlPatterns, lowerMethods, mapCacheOptions, mapRequestOptions, withNeutralDefaults } from "./mapping.ts";
import type { TokenStore } from "./tokens.ts";
import type { PluginConfigs, RequestSpec } from "./types.ts";

/** 被测客户端向执行器上报事件用的回调集合 */
export interface ClientHooks {
  /** loading 显示 / 隐藏 */
  loading(visible: boolean): void;
  /** 触发了一次提示 */
  notify(message: string): void;
  /** 实际发起了一次刷新调用 */
  refresh(): void;
  /** 会话过期（axp 每轮只通知一次） */
  expired(): void;
  /** 越权（403） */
  denied(): void;
  /** 本地没有令牌，请求被拒 */
  unauthenticated(): void;
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
  /** 外部提供的取消信号（cancel_after_ms 用） */
  signal?: AbortSignal;
}

/** 被测客户端句柄 */
export interface ClientHandle {
  axios: AxiosInstance;
  /** 通过 axp 发请求，返回客户端最终拿到的数据（信封已解包）；失败时抛出 IAxpResponse */
  send(spec: RequestSpec, extra: SendExtra): Promise<unknown>;
  /** 取消全部在途请求，返回本次取消的数量 */
  cancelAll(): number;
  /** 清空缓存，返回清掉的条目数 */
  clearCache(): number;
  /** 切换 baseURL（network step 切到 dns 时用；已装的 mock 基址不随之变化） */
  setBaseURL(url: string): void;
  dispose(): void;
}

/** 默认响应类型下的插件（带管理 API 的插件也能放进同一个数组） */
type ClientPlugin = AxpPlugin<AxpResponse, any>;

/** 带 body 的方法 */
const BODY_METHODS = new Set(["post", "put", "patch", "delete"]);
/** 刷新接口路径 */
const REFRESH_PATH = "/t/auth/refresh";
/** axp 本地无令牌拒绝时，失败响应的 reason */
const REASON_UNAUTHENTICATED = "unauthenticated";

/**
 * 构造 auth 插件：刷新走裸 axios（不经插件链）；过期、越权、无令牌三类通知转成执行器事件。
 * @param opts 客户端参数
 * @param cfg 场景的 auth 中立配置
 * @param getBase 读取当前 baseURL（network step 会改它）
 */
function buildAuth(opts: ClientOptions, cfg: Record<string, unknown>, getBase: () => string | undefined): ClientPlugin {
  const { tokens, hooks } = opts;
  const refreshQuery = (cfg.refresh_query ?? undefined) as Record<string, unknown> | undefined;
  const bare = axios.create({ adapter: opts.adapter, timeout: opts.baseTimeoutMs, validateStatus: () => true });
  return axpAuth({
    tokenManager: tokens,
    urlPattern: authUrlPatterns(cfg.url_pattern as string | undefined),
    onRefresh: async () => {
      const refresh = tokens.refreshToken;
      if (!refresh) return false;
      hooks.refresh();
      try {
        const res = await bare.post(
          REFRESH_PATH,
          { refresh_token: refresh },
          {
            baseURL: getBase(),
            params: refreshQuery,
            headers: { [HEADER_RUN]: opts.runId, [HEADER_STYLE]: opts.getStyle() },
          },
        );
        const body = res.data as { code?: unknown; data?: { access_token?: string; refresh_token?: string } } | undefined;
        if (body?.code !== 0 || !body.data?.access_token) return false;
        tokens.set(body.data.access_token, body.data.refresh_token);
        return true;
      } catch {
        return false;
      }
    },
    onAccessExpired: () => hooks.expired(),
    onAccessDenied: (r) => (r.reason === REASON_UNAUTHENTICATED ? hooks.unauthenticated() : hooks.denied()),
  });
}

/**
 * 按场景的中立插件配置组装插件列表。cancel / key / normalize / log 是内核能力，不用装配。
 * @param opts 客户端参数
 * @param p 场景的中立插件配置
 * @param instance 被测客户端用的 axios 实例（取当前 baseURL）
 * @returns 要传给 createAxp 的插件
 */
function buildPlugins(opts: ClientOptions, p: PluginConfigs, instance: AxiosInstance): ClientPlugin[] {
  const plugins: ClientPlugin[] = [];
  if (p.envs) plugins.push(axpEnvs([]));
  if (p.auth) plugins.push(buildAuth(opts, p.auth, () => instance.defaults.baseURL));
  if (p.filter) plugins.push(axpFilter({}));
  if (p.repath) plugins.push(axpRepath({}));
  if (p.retry) {
    const r = p.retry as { max?: number; delay_ms?: number; statuses?: number[]; methods?: string[]; respect_retry_after?: boolean };
    plugins.push(
      axpRetry({
        max: r.max,
        delay: r.delay_ms,
        statusCodes: r.statuses ?? [...DEFAULT_RETRY_STATUSES],
        methods: lowerMethods(r.methods ?? [...DEFAULT_RETRY_METHODS]),
        respectRetryAfter: r.respect_retry_after,
      }),
    );
  }
  if (p.notify) plugins.push(axpNotify({ notify: (message) => opts.hooks.notify(message) }));
  if (p.cache) plugins.push(axpCache(mapCacheOptions(p.cache as { ttl_ms?: number; max?: number; methods?: string[] })));
  if (p.share) plugins.push(axpShare({ policy: (p.share as { policy?: "start" | "end" | "race" }).policy }));
  if (p.mock) {
    const fb = (p.mock as { fallback_on_404?: boolean }).fallback_on_404;
    plugins.push(axpMock({ enable: true, mockUrl: `${opts.baseURL}${MOCK_PREFIX}`, fallbackWhen: fb === false ? () => false : undefined }));
  }
  if (p.loading) {
    const l = p.loading as { delay_ms?: number; delay_close_ms?: number };
    plugins.push(axpLoading({ loading: (visible) => opts.hooks.loading(visible), delay: l.delay_ms, delayClose: l.delay_close_ms }));
  }
  return plugins;
}

/**
 * 中立 `normalize: false` 只关闭这次请求的业务码判定：请求带 `throws: false` 发出，
 * 业务码失败（`kind: 'biz'`）按成功交回信封里的 data，HTTP、网络等其它失败照常抛出，返回形态与普通请求一致。
 * @param pending 带 `throws: false` 发出的请求
 * @returns 成功或业务码失败时的 data
 * @throws 非业务码的失败响应
 */
async function passBusinessFailure(pending: Promise<AxpResponse>): Promise<unknown> {
  const response = await pending;
  if (response.ok || response.kind === AXP_KINDS.BIZ) return response.data;
  throw response;
}

/**
 * 按场景的中立插件配置组装 axp 客户端（`createAxp`），并返回操作句柄。
 * 被测对象是 dist/esm 的打包产物（由 vitest alias / 包名自引用指向）。
 * 响应工厂用 `axpResponse({ expectJson: true })`：声明 JSON/HTML 却没解析成功的 2xx 响应记为 `kind: 'parse'`；
 * normalize 是内核能力，所有场景一视同仁地按信封业务码判定成败。
 * @param opts 客户端参数
 * @returns 客户端句柄
 * @throws 映射不了的配置在 plan 阶段已由 validateScenarioMapping 拦截，这里不重复校验
 */
export function createClient(opts: ClientOptions): ClientHandle {
  const instance = axios.create({ adapter: opts.adapter, baseURL: opts.baseURL, timeout: opts.baseTimeoutMs });
  const p = opts.plugins ?? {};
  const scope = (p.key as { scope?: string } | undefined)?.scope;
  const api = createAxp({
    axios: instance,
    response: axpResponse({ expectJson: true }),
    ...(scope === "user" ? { key: { scope: () => opts.tokens.user } } : {}),
    plugins: buildPlugins(opts, p, instance),
  });

  return {
    axios: instance,
    send(spec, extra) {
      const method = (spec.method ?? "GET").toLowerCase();
      const config: AxpRequestConfig = {
        url: spec.path,
        method,
        params: spec.query,
        headers: { [HEADER_RUN]: opts.runId, [HEADER_STYLE]: opts.getStyle(), ...spec.headers },
        ...withNeutralDefaults(mapRequestOptions(spec.options), opts.plugins),
      };
      if (BODY_METHODS.has(method)) config.data = spec.body;
      if (extra.signal) config.signal = extra.signal;
      if (config.throws === false) return passBusinessFailure(api.request(config) as Promise<AxpResponse>);
      return api.request(config);
    },
    cancelAll: () => api.cancelAll(),
    clearCache: () => clearCache(api),
    setBaseURL(url) {
      instance.defaults.baseURL = url;
    },
    dispose: () => api.dispose(),
  };
}
