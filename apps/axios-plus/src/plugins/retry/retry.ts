import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import type { Plugin, PluginLogger } from "../../plugin/types";
import { __DEV__, AUTH_REFRESHED_KEY, RETRY_KEY, SHARE_SETTLED_KEY, requirePlugin, tagOf , lockName} from "../../helper";
import ApiResponse, { ERR_CODES } from "../../objects/ApiResponse";
import type { IRetryOptions, TShouldRetry, TBeforeRetry } from "./types";
import { name as normalizeName } from '../normalize';

export const name = "retry";

// ───────────────────────────────────────────────────────────────────────────
//  默认值
// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX = 2;
const DEFAULT_METHODS: readonly string[] = [
  "get",
  "put",
  "head",
  "delete",
  "options",
  "trace",
];
const DEFAULT_STATUS: readonly number[] = [408, 413, 429, 500, 502, 503, 504];
/** 默认会重试的归一化 code（不含 CANCEL —— 用户主动取消永不重试） */
const DEFAULT_CODES: readonly string[] = [
  ERR_CODES.NETWORK,
  ERR_CODES.TIMEOUT,
  ERR_CODES.HTTP,
];
const DEFAULT_DELAY = (n: number): number => 0.3 * 2 ** (n - 1) * 1000;
const RETRY_AFTER_HEADERS: readonly string[] = [
  "retry-after",
  "ratelimit-reset",
  "x-ratelimit-retry-after",
  "x-ratelimit-reset",
  "x-rate-limit-reset",
];

/**
 * 失败重试插件 —— **仅** onFulfilled 路径。
 *
 * 必须在 `normalize` 之后 use（依赖 `response.data: ApiResponse` 来判断成功/失败）。
 *
 *   - **触发条件**：`response.data.success === false`
 *   - **默认仅重试幂等方法 + 已知可重试状态码 + 已知错误码**
 *   - **CANCEL 永不重试**（即使 shouldRetry 返回 true 也不会触发重试 —— 因为 cancel
 *     的 axios.request 重发会立即被同一个 abort signal 再次中止，无意义）
 *   - **指数退避 + jitter + Retry-After 头**
 *   - **唯一裁决钩子 `shouldRetry(apiResp, response)`** 优先级最高
 *   - **`max:-1` 无限重试**（务必配合 `shouldRetry` 限流）
 *   - **`__retry` 计数挂在 config 上**：跨 `axios.request` 调用自动随 mergeConfig 传递
 */
export default function retry(options: IRetryOptions = {}): Plugin {
  const cfg = $normalize(options);
  return {
    name,
    install(ctx) {
      requirePlugin(ctx, normalizeName);
      if (__DEV__)
        ctx.logger.log(`${name} enabled:${cfg.enable} max:${$fmtMax(cfg.max)}`);
      if (!cfg.enable) return;

      ctx.response((response: AxiosResponse) => {
        const apiResp = response.data;
        if (!(apiResp instanceof ApiResponse)) return response;
        if (apiResp.success) {
          // 成功路径仍允许 shouldRetry 强制重试（业务上"成功响应里夹错"的极端场景）
          const c = $merge(cfg, response.config);
          if (c.shouldRetry?.(apiResp, response) !== true) {
            $reset(response.config);
            return response;
          }
          return $attempt(ctx, c, response.config, apiResp, response, true);
        }

        // 失败路径
        const c = $merge(cfg, response.config);
        return $attempt(ctx, c, response.config, apiResp, response, false);
      });
    },
  };
}

/**
 * 重试单次入口。`bypassDefaults=true` 来自 shouldRetry 已显式判定 true 的场景。
 *
 * 倒计时算法：
 *   - 首次失败：`__retry` 不在 config → 初始化为 cfg.max；max=0 直接返回原 response
 *   - 已设：`__retry === 0` → 预算耗尽返回原 response；`-1` 永远重试不递减
 */
async function $attempt(
  ctx: { axios: AxiosInstance; logger: PluginLogger },
  c: IRetryConfig,
  config: AxiosRequestConfig,
  apiResp: ApiResponse,
  response: AxiosResponse,
  bypassDefaults: boolean,
): Promise<AxiosResponse> {
  // share race 联动：同 key 已有赢家 → 跳过本请求重试（caller 拿的是共享 promise 里赢家的响应，自己重试无意义）
  const raceSettled = (config as Record<string, unknown>)[SHARE_SETTLED_KEY];
  if (typeof raceSettled === "function" && (raceSettled as () => boolean)()) {
    $reset(config);
    return response;
  }

  // auth 联动：refresh 后 / replay 重发不再叠加 retry —— 否则用户的 max=3 实际可能跑成 7+ 次
  // （retry 用尽后 auth 启动 refresh + 重发 → retry 把它当全新请求又跑一轮）
  if ((config as Record<string, unknown>)[AUTH_REFRESHED_KEY] === true) {
    $reset(config);
    return response;
  }

  // CANCEL 永不重试 —— 即使 bypassDefaults 也不重试
  if (apiResp.code === ERR_CODES.CANCEL) {
    $reset(config);
    return response;
  }

  const cur = $read(config);
  if (cur === undefined) {
    if (c.max === 0) return response;
    $write(config, c.max);
  } else if (cur === 0) {
    $reset(config);
    return response;
  }

  // shouldRetry 显式裁决（onRejected 等价路径）
  let forced: boolean | undefined;
  if (!bypassDefaults && c.shouldRetry) {
    const r = c.shouldRetry(apiResp, response);
    if (r === false) {
      $reset(config);
      return response;
    }
    if (r === true) forced = true;
  }

  // 默认规则
  if (!bypassDefaults && forced !== true) {
    if (!$decide(c, config, apiResp)) {
      $reset(config);
      return response;
    }
  }

  const budget = $read(config)!;
  const attempt = budget === -1 ? 1 : c.max - budget + 1;

  // Retry-After（仅当 status 命中状态码白名单时有意义）
  let delayMs: number;
  if (response.status && c.status.includes(response.status)) {
    const fromHeader = $parseRetryAfter(response, c);
    delayMs = fromHeader ?? $computeDelay(c, attempt);
  } else {
    delayMs = $computeDelay(c, attempt);
  }

  if (c.beforeRetry) {
    try {
      const r = await c.beforeRetry({
        apiResp,
        response,
        request: config,
        retryCount: attempt,
      });
      if (r === false) {
        $reset(config);
        return response;
      }
    } catch {
      // 钩子抛错 → 当作 false（取消重试），保持当前响应
      $reset(config);
      return response;
    }
  }

  if (budget !== -1) $write(config, budget - 1);

  if (__DEV__) {
    ctx.logger.log(
      `${name} retry attempt=${attempt} budget=${$read(config)} ${tagOf(config)} delay=${delayMs}ms`,
    );
  }
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  return ctx.axios.request(config);
}

// ───────────────────────────────────────────────────────────────────────────
//  默认决策与延迟
// ───────────────────────────────────────────────────────────────────────────

/**
 * 默认重试规则：
 *   - methods 白名单
 *   - 命中 status 白名单 → 重试
 *   - 命中 codes 白名单（NETWORK_ERR / TIMEOUT_ERR / HTTP_ERR）→ 重试
 *   - 超时码（TIMEOUT_ERR）：仅 `retryOnTimeout=true` 时重试
 * @internal exported for unit tests
 */
export function $decide(
  c: IRetryConfig,
  config: AxiosRequestConfig,
  apiResp: ApiResponse,
): boolean {
  const method = (config.method || "get").toLowerCase();
  if (!c.methods.includes(method)) return false;

  // status 命中
  if (apiResp.status > 0 && c.status.includes(apiResp.status)) return true;

  // code 命中（先把 timeout 单独判一下）
  const code = String(apiResp.code ?? "");
  if (code === ERR_CODES.TIMEOUT) return c.retryOnTimeout;
  if (code === ERR_CODES.CANCEL) return false;
  if (c.codes.includes(code)) return true;

  return false;
}

/**
 * 计算单次延迟（不含 Retry-After）：base = `delay(attempt)`，应用 jitter，受 `delayMax` 封顶。
 * @internal exported for unit tests
 */
export function $computeDelay(c: IRetryConfig, attempt: number): number {
  const base = typeof c.delay === "function" ? c.delay(attempt) : c.delay;
  let d = base;
  if (c.jitter === true) d = Math.random() * base;
  else if (typeof c.jitter === "function") d = c.jitter(base);
  const cap =
    typeof c.delayMax === "function" ? c.delayMax(attempt) : c.delayMax;
  return Math.max(0, Math.min(cap, d));
}

/**
 * 解析响应里的限流头（`Retry-After` / `RateLimit-*`），返回 ms（受 `retryAfterMax` 封顶）。
 * @internal exported for unit tests
 */
export function $parseRetryAfter(
  response: AxiosResponse,
  c: IRetryConfig,
): number | undefined {
  const raw = $readHeader(response.headers);
  if (!raw) return undefined;

  let after = Number(raw) * 1000;
  if (Number.isNaN(after)) {
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return undefined;
    after = t - Date.now();
  } else if (after >= Date.parse("2024-01-01")) {
    after -= Date.now();
  }
  if (!Number.isFinite(after)) return undefined;
  return Math.min(c.retryAfterMax, Math.max(0, after));
}

function $readHeader(headers: AxiosResponse["headers"]): string | undefined {
  if (!headers) return undefined;
  const get =
    typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get: (k: string) => string | null | undefined }).get.bind(
          headers,
        )
      : null;
  for (const k of RETRY_AFTER_HEADERS) {
    const v = get
      ? get(k)
      : ((headers as Record<string, unknown>)[k] ??
        (headers as Record<string, unknown>)[k.toUpperCase()]);
    if (v != null && v !== "") return String(v);
  }
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
//  归一化与请求级合并
// ───────────────────────────────────────────────────────────────────────────

export interface IRetryConfig {
  enable: boolean;
  max: number;
  methods: string[];
  status: number[];
  codes: string[];
  delay: number | ((attempt: number) => number);
  delayMax: number | ((attempt: number) => number);
  retryAfterMax: number;
  jitter: boolean | ((delay: number) => number);
  retryOnTimeout: boolean;
  shouldRetry?: TShouldRetry;
  beforeRetry?: TBeforeRetry;
}

/** @internal */
export function $normalize(opts: IRetryOptions): IRetryConfig {
  return {
    enable: opts.enable ?? true,
    max: $resolveMax(opts.max),
    methods: $mergeArr(
      DEFAULT_METHODS,
      opts.methods?.map((m) => m.toLowerCase()),
    ),
    status: $mergeArr(DEFAULT_STATUS, opts.status),
    codes: $mergeArr(DEFAULT_CODES, opts.codes),
    delay: opts.delay ?? DEFAULT_DELAY,
    delayMax: opts.delayMax ?? Infinity,
    retryAfterMax: opts.retryAfterMax ?? Infinity,
    jitter: opts.jitter ?? false,
    retryOnTimeout: opts.retryOnTimeout ?? false,
    shouldRetry: opts.shouldRetry,
    beforeRetry: opts.beforeRetry,
  };
}

/** max 归一化（含布尔捷径 + -1 无限）@internal */
export function $resolveMax(v: number | boolean | undefined): number {
  if (v === false || v === 0) return 0;
  if (v === true || v === undefined) return DEFAULT_MAX;
  if (typeof v === "number") return v;
  return DEFAULT_MAX;
}

/** 默认数组 ⊕ 用户数组，去重保序 @internal */
export function $mergeArr<T>(
  defaults: readonly T[],
  user: readonly T[] | undefined,
): T[] {
  if (!user) return defaults as T[];
  const set = new Set([...defaults, ...user]);
  return [...set];
}

/**
 * 把请求级 `config.retry` 合并到插件级 cfg。
 *   - 复用插件级 cfg：未传 / true / 等价标量 → 直接返回 cfg
 *   - 仅 max 变化：浅复制
 *   - 对象形态：浅复制一份后字段级赋值
 * @internal exported for unit tests
 */
export function $merge(
  cfg: IRetryConfig,
  config: AxiosRequestConfig,
): IRetryConfig {
  let v = config.retry as unknown;
  if (typeof v === "function")
    v = (v as (c: AxiosRequestConfig) => unknown)(config);
  if (v === undefined || v === true) return cfg;
  if (v === false || v === 0) return cfg.max === 0 ? cfg : { ...cfg, max: 0 };
  if (typeof v === "number") {
    const m = $resolveMax(v);
    return m === cfg.max ? cfg : { ...cfg, max: m };
  }
  if (typeof v !== "object" || v === null) return cfg;
  const o = v as Partial<IRetryOptions>;
  const c: IRetryConfig = { ...cfg };
  if (o.max !== undefined) c.max = $resolveMax(o.max);
  if (o.methods)
    c.methods = $mergeArr(
      cfg.methods,
      o.methods.map((m) => m.toLowerCase()),
    );
  if (o.status) c.status = $mergeArr(cfg.status, o.status);
  if (o.codes) c.codes = $mergeArr(cfg.codes, o.codes);
  if (o.delay !== undefined) c.delay = o.delay;
  if (o.delayMax !== undefined) c.delayMax = o.delayMax;
  if (o.retryAfterMax !== undefined) c.retryAfterMax = o.retryAfterMax;
  if (o.jitter !== undefined) c.jitter = o.jitter;
  if (o.retryOnTimeout !== undefined) c.retryOnTimeout = o.retryOnTimeout;
  if (o.shouldRetry !== undefined) c.shouldRetry = o.shouldRetry;
  if (o.beforeRetry !== undefined) c.beforeRetry = o.beforeRetry;
  return c;
}

// ───────────────────────────────────────────────────────────────────────────
//  __retry 字段读写
// ───────────────────────────────────────────────────────────────────────────

/** 读 `__retry` @internal */
export function $read(config: AxiosRequestConfig): number | undefined {
  const v = (config as Record<string, unknown>)[RETRY_KEY];
  return typeof v === "number" ? v : undefined;
}

/** 写 `__retry` @internal */
export function $write(config: AxiosRequestConfig, n: number): void {
  (config as Record<string, unknown>)[RETRY_KEY] = n;
}

/** 删 `__retry` @internal */
export function $reset(config: AxiosRequestConfig | undefined | null): void {
  if (!config) return;
  delete (config as Record<string, unknown>)[RETRY_KEY];
}

function $fmtMax(m: number): string {
  if (m === 0) return "0";
  if (m === -1) return "∞";
  return String(m);
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(retry)` 在 minify 后仍能识别
lockName(retry, name);
