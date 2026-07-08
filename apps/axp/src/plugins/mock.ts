
import type { Plugin } from '../types';
import { pluginLog, pluginWarn } from '../helper';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';


const name = 'axp:mock'

/**
 * Mock 插件：命中请求**优先打 mock，mock 不存在则自动回落真实接口**。
 * （mock 仅应在开发环境启用 `enable: import.meta.env.DEV`，故回落即默认行为，无需开关。）
 *   - **触发判定**：`config.mock` 为真，或插件级 `mock: true` 兜底
 *   - **URL 改写**：见 `$rewriteUrl`（绝对/相对/无 url 三种）
 *   - **回落**：先打 mock，mock **不存在**（默认：HTTP 404，或不可达的网络错误）→ 改用
 *     **原始请求**打真实接口；判定可由 `fallbackWhen` 自定义（如把 5xx/501 也视为"无 mock"）
 *   - **实现层**：基于 adapter 包装（而非拦截器）——只有 adapter 能"先发 mock、看结果、再改发真实"。
 *     回落只重走底层 adapter，不会二次触发其它拦截器
 *
 * Mock plugin: a matched request is sent to mock first, and automatically falls
 * back to the real endpoint if the mock doesn't exist (default: HTTP 404, or a
 * network error meaning the mock address is unreachable — customizable via
 * `fallbackWhen`). Adapter-based (not an interceptor) because only an adapter
 * can send mock, inspect the result, then re-send for real without
 * re-triggering other interceptors.
 *
 * @example
 *   useAxiosPlugin(ax).use(mock({
 *     enable: import.meta.env.DEV,
 *     mockUrl: 'http://localhost:4523',
 *   }));
 *
 *   ax.get('/api/x', { mock: true });                  // 先 mock，404/不可达则真实
 *   ax.get('/api/y', { mock: { mockUrl: 'http://m2' } });
 * @param options 插件配置：enable/mock/mockUrl/fallbackWhen / plugin config: enable/mock/mockUrl/fallbackWhen
 * @returns Plugin：install 时包装 adapter 实现 mock-先行/回落真实，卸载还原 adapter / a Plugin implementing mock-first/fallback-to-real on install, restores the adapter on teardown
 */
export default function axpMock(
  { enable = false, mock: mockGlobal = false, mockUrl, fallbackWhen }: IMockOptions = {},
): Plugin {
  const defaults: IMockOptions = { mock: mockGlobal, mockUrl, fallbackWhen };
  return {
    name,
    install(axios) {
      pluginLog(axios.defaults, `[${name}] enabled:${enable} mockUrl:${mockUrl ?? '<none>'}`);
      if (!enable) return;
      const prev = axios.defaults.adapter as AxiosAdapter;
      axios.defaults.adapter = (config) => {
        const opt = $resolveMock(config, defaults);
        delete config.mock;
        if (!opt) return prev(config);
        if (!opt.mockUrl) {
          pluginWarn(config, `[${name}] skipped: no mockUrl`);
          return prev(config);
        }

        // 克隆出 mock 专用 config（保留原始 config 以便回落真实接口）。
        // 显式关掉 cache/share：mockConfig 与 config 共享同一个 config.key，若探测 mock 时
        // 被 cache/share 用该 key 写入/占用了条目，真实回落调用会命中"mock 探测"留下的脏数据。
        const mockConfig = { ...config, cache: false as const, share: false as const };
        $rewriteUrl(mockConfig, opt.mockUrl);

        // 先打 mock，不存在(404/不可达)则回落原始请求 → 真实接口
        const decide = opt.fallbackWhen ?? $shouldFallback;
        return prev(mockConfig).then(
          (response) => {
            if (decide({ response })) {
              pluginLog(config, `[${name}] fallback → real (mock status ${response.status})`);
              return prev(config);
            }
            return response;
          },
          (error) => {
            if (decide({ error })) {
              pluginLog(config, `[${name}] fallback → real (mock unreachable)`);
              return prev(config);
            }
            return Promise.reject(error);
          },
        );
      };
      return () => { axios.defaults.adapter = prev; };
    },
  };
}


/**
 * 仅判断"是否启用 mock" / determines only "whether mock is enabled" for this request.
 * @internal exported for unit tests
 * @param config 请求配置 / the request config
 * @param defaults 插件级默认配置 / plugin-wide defaults
 * @returns 本次请求是否应该走 mock / whether this request should go through mock
 */
export function $shouldMock(config: AxiosRequestConfig, defaults: IMockOptions): boolean {
  const v = config.mock;
  if (v === false) return false;
  if (v === true) return true;
  if (typeof v === 'object' && v !== null) {
    if (v.mock === false) return false;
    return v.mock === true || !!v.mockUrl;
  }
  return !!defaults.mock;
}


/**
 * 解析 mock 配置；null 表示本请求不 mock / resolves the mock config; null means not mocked.
 * @internal
 * @param config 请求配置 / the request config
 * @param defaults 插件级默认配置 / plugin-wide defaults
 * @returns 解析后的 mock 配置，或 null / the resolved config, or null if not mocked
 */
export function $resolveMock(config: AxiosRequestConfig, defaults: IMockOptions): IResolvedMock | null {
  const v = config.mock;
  if (v === false) return null;
  if (v === true) return pick(undefined, defaults);
  if (typeof v === 'object' && v !== null) {
    if (v.mock === false) return null;
    return pick(v, defaults);
  }
  return defaults.mock ? pick(undefined, defaults) : null;
}

/**
 * 合并请求级 override 与插件级 defaults（请求级优先）。未指定字段保持 undefined，以便与
 * 历史断言 `toEqual({ mockUrl })` 兼容（toEqual 忽略 undefined 字段）。
 *
 * Merges a per-request override with plugin-wide defaults (per-request wins).
 * Unspecified fields stay `undefined` to remain compatible with legacy
 * `toEqual({ mockUrl })` assertions (which ignore `undefined` fields).
 *
 * @param v 请求级 mock 对象 / the per-request mock object (may be undefined)
 * @param defaults 插件级默认配置 / plugin-wide defaults
 * @returns 合并后的已解析 mock 配置 / the merged, resolved config
 */
function pick(v: IMockObject | undefined, defaults: IMockOptions): IResolvedMock {
  return {
    mockUrl: v?.mockUrl ?? defaults.mockUrl,
    fallbackWhen: v?.fallbackWhen ?? defaults.fallbackWhen,
  };
}


/** 默认"mock 不存在"判定：HTTP 404，或不可达的网络错误（排除主动取消） / default "mock doesn't exist" check: HTTP 404, or unreachable network error (excludes cancellation) @internal */
export function $shouldFallback(info: { response?: AxiosResponse; error?: any }): boolean {
  if (info.response) return info.response.status === 404;
  const e = info.error;
  if (e && (e.code === 'ERR_CANCELED' || e.name === 'CanceledError')) return false; // 用户取消，不回落
  return !!e; // 网络层错误（连接被拒/超时等）= mock 不可达
}


/** 将 config.url / config.baseURL 重写到 mockUrl / rewrites config.url / config.baseURL to point at mockUrl @internal */
export function $rewriteUrl(config: AxiosRequestConfig, mockUrl: string): void {
  const url = config.url;
  if (!url) {
    config.baseURL = mockUrl;
    return;
  }
  if (isAbsoluteURL(url)) {
    // 完整 URL：去掉原 origin，把 path/search 拼到 mockUrl 后
    try {
      const u = new URL(url);
      config.url = combineURLs(mockUrl, u.pathname + u.search + u.hash);
    } catch {
      // 解析失败时退化为简单拼接
      config.url = combineURLs(mockUrl, url);
    }
  } else {
    config.url = combineURLs(mockUrl, url);
  }
}


/** 简化版：是否绝对 URL / simplified check: whether url is absolute */
function isAbsoluteURL(url: string): boolean {
  return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
}

/** 简化版：处理结尾 / 与开头 / 的拼接 / simplified join: handles a trailing/leading slash */
function combineURLs(base: string, rel: string): string {
  return rel ? `${base.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}` : base;
}


/** 自定义"mock 不存在"判定：返回 true 触发回落到真实接口 / custom "mock doesn't exist" decider: return true to trigger fallback */
export type MockFallbackDecider = (info: { response?: AxiosResponse; error?: unknown }) => boolean;

/** 请求级 config.mock 的对象形式（内部） / the object form of per-request config.mock (internal) */
interface IMockObject {
  /** 是否启用 mock（对象形式内的显式开关） / whether mock is enabled (explicit switch within the object form) */
  mock?: boolean;
  /** 本请求专用的 mock 服务器地址（覆盖插件级） / mock server address for this request only (overrides plugin-wide) */
  mockUrl?: string;
  /** 本请求专用的回落判定（覆盖插件级） / fallback decider for this request only (overrides plugin-wide) */
  fallbackWhen?: MockFallbackDecider;
}

/** `$resolveMock` 解析出的请求级配置（内部中间态） / the per-request config resolved by $resolveMock (internal) */
interface IResolvedMock {
  /** 本请求生效的 mock 服务器地址 / effective mock server address for this request */
  mockUrl?: string;
  /** 本请求生效的回落判定 / effective fallback decider for this request */
  fallbackWhen?: MockFallbackDecider;
}

export interface IMockOptions {
  /** 插件级总开关；建议设为 import.meta.env.DEV 之类的编译期常量，默认 false / plugin-wide kill switch; recommend a compile-time constant like import.meta.env.DEV, defaults to false */
  enable?: boolean;
  /** 默认是否 mock；true 时所有请求走 mockUrl，除非请求级显式 mock: false / default mock-or-not; true routes all requests through mockUrl unless overridden with mock: false */
  mock?: boolean;
  /** mock 服务器基地址 / the mock server base URL */
  mockUrl?: string;
  /** 自定义"mock 不存在"判定；返回 true 触发回落，默认 404 或网络不可达 / custom "mock doesn't exist" decider; true triggers fallback, default 404 or unreachable */
  fallbackWhen?: MockFallbackDecider;
}


declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * mock 配置（mock 不存在时自动回落真实接口）：
     *   - `false` → 不 mock（覆盖插件级）
     *   - `true` → 启用，使用插件级 mockUrl
     *   - `{ mock?, mockUrl?, fallbackWhen? }` → 自定义
     *
     * Mock config (falls back to the real endpoint automatically if the mock
     * doesn't exist): `false` → not mocked; `true` → enabled, uses plugin-wide
     * `mockUrl`; object form customizes.
     */
    mock?: boolean | { mock?: boolean; mockUrl?: string; fallbackWhen?: MockFallbackDecider };
  }
}
