import type { Plugin } from "../types";
import { pluginLog } from "../helper";
import axiosLib, { AxiosError } from "axios";
import type {
  AxiosRequestConfig,
  AxiosResponse,
  GenericAbortSignal,
  InternalAxiosRequestConfig,
} from "axios";

const name = "axp:retry";

/**
 * 失败重试插件：请求失败（或被判定为业务异常）后按 `delay` 等待、重发，最多 `max` 次。
 *
 * Retry-on-failure plugin: waits `delay`, then resends — up to `max` times — on
 * failure or a response judged a business exception.
 *
 *   - 重发走一个**裸的、不带任何拦截器**的独立 axios 实例（`retrier`）——永远不会
 *     重新进入本插件链，下游插件（notify/normalize 等）不会为同一个逻辑请求触发
 *     两次；整个重试循环活在一次拦截器调用里，不需要靠 config 字段跨 mergeConfig
 *     存活来记计数（对齐 dioman `DiomanRetry` 用裸 `Dio()` 重发的设计）。
 *   - `methods` 白名单是硬性否决：方法不在表里直接不重试，`shouldRetry` 说了也不算
 *     （默认幂等动词、不含 post/patch，对齐 ky——防止一次误判导致重复的创建/扣款
 *     之类副作用）。方法过了才轮到是否重试：
 *     `shouldRetry?.(response?, err?) ?? statusCodes.includes(status) ?? false`——
 *     给了 `shouldRetry` 且返回明确 true/false 就采用；没给或返回 undefined 就退回
 *     按状态码表（默认 `[408,429,500,502,503,504]`，对齐 Dio 默认 `retryIf` 排除 501）。
 *   - `delay` 支持常量或函数；等待期间会监听 `config.signal`——请求被 cancel 插件
 *     （或任何 abort）取消时立刻停止等待并清掉定时器，不会"空滑行"到时间到了才
 *     发现已经被取消。重发请求本身仍带着同一个 `signal`，被取消时 axios 自己就会
 *     拒绝，不需要额外处理。
 *   - 响应带 `Retry-After` 头时优先听服务端的（数字按秒、也支持 HTTP-date），不算
 *     `delay`；只在 `afterStatusCodes`（默认 `[413,429,503]`）覆盖的状态码上采信，
 *     其它状态码（比如普通 500/502/504）即使带了也不认；由 `retryAfterMax` 兜底
 *     封顶（默认不封顶），`respectRetryAfter:false` 可整体关掉这条（都对齐 ky）。
 *
 * The resend goes through a **bare, interceptor-less** standalone axios
 * instance (`retrier`) — it never re-enters this plugin chain, so downstream
 * plugins (notify/normalize, etc.) never fire twice for one logical request;
 * the whole retry loop lives inside a single interceptor invocation, so no
 * count needs to survive `mergeConfig` via a config field (mirrors dioman's
 * `DiomanRetry`, which resends through a bare `Dio()`).
 * The `methods` whitelist is a hard veto: a method outside it is never
 * retried, even if `shouldRetry` would say otherwise (defaults to idempotent
 * verbs, excluding post/patch — mirrors ky, guarding against duplicate side
 * effects like a double create/charge from one bad call). Only once the
 * method passes does retry-worthiness get decided: `shouldRetry?.(response?,
 * err?) ?? statusCodes.includes(status) ?? false` — an exact `true`/`false`
 * from `shouldRetry` wins outright; `undefined` (or no `shouldRetry` at all)
 * falls through to the status-code table (default `[408,429,500,502,503,504]`,
 * mirroring Dio's default `retryIf` excluding 501).
 * `delay` accepts a constant or a function; while waiting it listens on
 * `config.signal` — if the request is canceled (by the `cancel` plugin or any
 * abort) mid-wait, the wait stops immediately and the timer is cleared,
 * instead of idling until the timer fires only to discover it was already
 * canceled. The resend itself still carries the same `signal`, so axios
 * rejects it on its own if canceled — no extra handling needed there.
 * When the response carries a `Retry-After` header, that wins over `delay`
 * (seconds or an HTTP-date, both supported) — but only for statuses covered by
 * `afterStatusCodes` (default `[413,429,503]`); other statuses (e.g. a plain
 * 500/502/504) ignore it even if present. The resulting wait is capped by
 * `retryAfterMax` (default uncapped); set `respectRetryAfter: false` to
 * disable the whole feature (all mirror ky).
 *
 * @param options 插件配置：`max`/`methods`/`shouldRetry`/`statusCodes`/`delay`/`jitter`/`delayMax`/`respectRetryAfter`/`afterStatusCodes`/`retryAfterMax` / plugin config: `max`/`methods`/`shouldRetry`/`statusCodes`/`delay`/`jitter`/`delayMax`/`respectRetryAfter`/`afterStatusCodes`/`retryAfterMax`
 */
export default function axpRetry({
  enable = true,
  max = 0,
  methods,
  shouldRetry,
  statusCodes,
  delay,
  jitter,
  delayMax = Infinity,
  respectRetryAfter = true,
  afterStatusCodes,
  retryAfterMax = Infinity,
}: IRetryOptions = {}): Plugin {
  const defaults: IRetryOptions = {
    max,
    methods,
    shouldRetry,
    statusCodes,
    delay,
    jitter,
    delayMax,
    respectRetryAfter,
    afterStatusCodes,
    retryAfterMax,
  };
  return {
    name,
    install(axios) {
      pluginLog(axios.defaults, `[${name}] enabled:${enable} max:${max}`);
      if (!enable) return;

      // 裸实例：不带任何拦截器，重发永远不会重新进入本链。config 是本次请求已经解析
      // 完成的完整配置（baseURL/adapter/headers 等已由 axios 自身 mergeConfig 并入），
      // 裸实例本身不需要克隆 defaults 也能正确重放。
      //
      // Bare instance with no interceptors — a resend never re-enters this chain.
      // `config` is already the fully-resolved config for this request (baseURL/
      // adapter/headers, etc. already merged in by axios's own mergeConfig), so the
      // bare instance doesn't need cloned defaults to replay it correctly.
      const retrier = axiosLib.create();

      const loop = async (
        config: InternalAxiosRequestConfig,
        initialErr?: any,
        initialResp?: AxiosResponse,
      ): Promise<any> => {
        const m = $resolveMax(config, defaults);
        const getDelay = $resolveDelay(config, defaults);
        const jitter = $resolveJitter(config, defaults);
        const delayMax = $resolveDelayMax(config, defaults);
        const cap = $resolveRetryAfterMax(config, defaults);
        const respectHeader = $resolveRespectRetryAfter(config, defaults);
        let err = initialErr;
        let resp = initialResp;
        for (let i = 1; i <= m; i++) {
          // Retry-After 是服务端明说的时间点，不叠加抖动/封顶（那两个只管本插件自己
          // 算出来的 delay）——跟 ky 一致。同时只在 afterStatusCodes 覆盖的状态码上
          // 采信这个头——429/503 这类限流/"稍后再来"场景才是这个头的标准语义，普通
          // 500/502/504 上即使碰巧带了也不认，照样走自己算的 delay（跟 ky 一致）。
          //
          // Retry-After is a timing the server stated explicitly — jitter/delayMax
          // (which only govern this plugin's own computed delay) don't apply to it,
          // matching ky. Also only trusted for statuses covered by
          // `afterStatusCodes` — 429/503-style rate-limit/"come back later"
          // semantics are what this header standardly means; a plain 500/502/504
          // carrying one anyway is not trusted, and falls back to the computed
          // delay regardless (matching ky).
          const respStatus = resp?.status ?? err?.response?.status;
          const headerEligible =
            respectHeader &&
            typeof respStatus === "number" &&
            $resolveAfterStatusCodes(config, defaults).includes(respStatus);
          const fromHeader = headerEligible
            ? $retryAfterMs(resp ?? err?.response, cap)
            : undefined;
          const wait =
            fromHeader ??
            $applyJitter(
              $computeDelay(getDelay, i, m, resp, err),
              jitter,
              delayMax,
            );
          if (wait > 0) await $delay(wait, config.signal);
          pluginLog(
            config,
            `[${name}] retry ${i}/${m} ${(config.method ?? "").toUpperCase()} ${config.url}`,
          );
          try {
            resp = await retrier.request(config);
            err = undefined;
            if (!$shouldRetry(config, defaults, resp, undefined)) return resp;
          } catch (e) {
            err = e;
            resp = undefined;
            if (!$shouldRetry(config, defaults, undefined, err))
              return Promise.reject(err);
          }
        }
        if (err) return Promise.reject(err);
        return Promise.reject(
          new AxiosError(
            `[${name}] exhausted retries`,
            undefined,
            config,
            undefined,
            resp,
          ),
        );
      };

      const id = axios.interceptors.response.use(
        async (response) => {
          const config = response.config;
          if ($shouldRetry(config, defaults, response, undefined))
            return loop(config, undefined, response);
          return response;
        },
        async (error: any) => {
          const config = error?.config;
          if (!config) return Promise.reject(error);
          if (!$shouldRetry(config, defaults, error?.response, error))
            return Promise.reject(error);
          return loop(config, error, error?.response);
        },
      );
      return () => {
        axios.interceptors.response.eject(id);
      };
    },
  };
}

/**
 * 可取消的延时：等待期间监听 `signal`，一旦 abort 立刻清掉定时器并结束等待——不会
 * 白等到定时器触发才发现请求已经被取消（“空滑行”）。已经是 aborted 状态则直接返回。
 *
 * Cancelable delay: listens on `signal` while waiting, clearing the timer and
 * ending the wait immediately on abort — never idles until the timer fires
 * only to find the request was already canceled. Resolves immediately if
 * already aborted.
 *
 * @internal
 */
function $delay(ms: number, signal?: GenericAbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", finish);
      resolve();
    }
    signal?.addEventListener?.("abort", finish, { once: true });
  });
}

/** 解析最大重试次数：请求级 > 插件级 > 0 / resolves max retry count: request-level > plugin-level > 0. @internal */
export function $resolveMax(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): number {
  const v = config.retry;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v && typeof v.max === "number") return v.max;
  return defaults.max ?? 0;
}

/** 解析 shouldRetry 判定函数：请求级 > 插件级 > undefined（不设默认值，交给状态码表兜底） / resolves the `shouldRetry` predicate: request-level > plugin-level > undefined (no default — falls through to the status-code table). @internal */
export function $resolveShouldRetry(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): TShouldRetry | undefined {
  const v = config.retry;
  if (typeof v === "object" && v && typeof v.shouldRetry === "function")
    return v.shouldRetry;
  return defaults.shouldRetry;
}

/** 解析该重试的状态码表：请求级 > 插件级 > 默认 [408,429,500,502,503,504] / resolves the retry-eligible status codes: request-level > plugin-level > default [408,429,500,502,503,504]. @internal */
export function $resolveStatusCodes(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): number[] {
  const v = config.retry;
  if (typeof v === "object" && v && v.statusCodes) return v.statusCodes;
  return defaults.statusCodes ?? DEFAULT_STATUS_CODES;
}

/** 解析"信 Retry-After 头"限定的状态码表：请求级 > 插件级 > 默认 [413,429,503] / resolves the status codes eligible to trust a Retry-After header: request-level > plugin-level > default [413,429,503]. @internal */
export function $resolveAfterStatusCodes(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): number[] {
  const v = config.retry;
  if (typeof v === "object" && v && v.afterStatusCodes) return v.afterStatusCodes;
  return defaults.afterStatusCodes ?? DEFAULT_AFTER_STATUS_CODES;
}

/** 解析 delay 配置：请求级 > 插件级 > 默认 3000ms / resolves the `delay` config: request-level > plugin-level > default 3000ms. @internal */
export function $resolveDelay(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): TRetryDelay {
  const v = config.retry;
  if (typeof v === "object" && v && v.delay != null) return v.delay;
  return defaults.delay ?? 3000;
}

/** 解析抖动策略：请求级 > 插件级 > 默认不抖动 / resolves the jitter strategy: request-level > plugin-level > no jitter by default. @internal */
export function $resolveJitter(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): TJitter | undefined {
  const v = config.retry;
  if (typeof v === "object" && v && v.jitter != null) return v.jitter;
  return defaults.jitter;
}

/** 解析 delay 的封顶值：请求级 > 插件级 > 默认不封顶 / resolves the cap on `delay`: request-level > plugin-level > uncapped by default. @internal */
export function $resolveDelayMax(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): number {
  const v = config.retry;
  if (typeof v === "object" && v && typeof v.delayMax === "number")
    return v.delayMax;
  return defaults.delayMax ?? Infinity;
}

/**
 * 给算出来的 delay 加抖动再封顶：`jitter:true` → 在 [0, delay) 内随机；`jitter` 为函数 →
 * 调用它拿抖动后的值，返回值非有限数或为负则退回原始 delay；最后统一用 `delayMax` 封顶。
 * 只作用于本插件自己算出来的 delay——服务端 `Retry-After` 给的时间点不经过这一步。
 *
 * Jitters then caps a computed delay: `jitter:true` → uniformly random within
 * [0, delay); a function `jitter` → call it for the jittered value, falling back
 * to the raw delay if the result isn't a finite, non-negative number; then caps
 * with `delayMax` either way. Only applies to this plugin's own computed delay —
 * a server-provided `Retry-After` timing skips this step entirely.
 *
 * @internal
 */
function $applyJitter(
  rawDelay: number,
  jitter: TJitter | undefined,
  cap: number,
): number {
  let jittered = rawDelay;
  if (jitter === true) {
    jittered = Math.random() * rawDelay;
  } else if (typeof jitter === "function") {
    const r = jitter(rawDelay);
    jittered = Number.isFinite(r) && r >= 0 ? r : rawDelay;
  }
  return Math.min(cap, jittered);
}

/** 解析该重试的方法白名单：请求级 > 插件级 > 默认（幂等的动词，见 DEFAULT_METHODS） / resolves the retry-eligible method whitelist: request-level > plugin-level > default (idempotent verbs, see DEFAULT_METHODS). @internal */
export function $resolveMethods(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): string[] {
  const v = config.retry;
  if (typeof v === "object" && v && v.methods) return v.methods;
  return defaults.methods ?? DEFAULT_METHODS;
}

/**
 * 单请求是否显式禁用了重试：`retry: false`，或对象形式的 `retry: { enable: false }`
 * （跟 `retry: false` 等价，只是走了完整 `IRetryOptions` 的字段而不是布尔简写）。
 *
 * Whether this request explicitly disables retry: `retry: false`, or the
 * object form's `retry: { enable: false }` (equivalent to `retry: false`, just
 * spelled via the full `IRetryOptions` field instead of the boolean shorthand).
 *
 * @internal
 */
function $isDisabled(config: AxiosRequestConfig): boolean {
  const v = config.retry;
  if (v === false) return true;
  return typeof v === "object" && v != null && v.enable === false;
}

/**
 * 是否该重试。优先级从高到低、每一级都能提前否决：
 *   1. 单请求禁用（`retry: false` 或 `retry: { enable: false }`）—— 最高优先级硬性否决
 *   2. `methods` 白名单 —— 方法不在表里直接否决，`shouldRetry` 说了也不算（对齐
 *      ky：非幂等动词默认不重试，不能被自定义判断绕过，防止一次误判导致的重复
 *      POST/PATCH 之类副作用）
 *   3. `shouldRetry?.(response?, err?) ?? statusCodes.includes(status) ?? false` ——
 *      返回明确的 true/false 就直接采用，返回 undefined 才退回状态码表
 * （`config.retry === true` 表示"不覆盖，尊重插件默认"，不在这里特殊处理——它
 * 不是 number 也不是对象，每个 `$resolve*` 都会自然落回插件级默认，效果一致。）
 *
 * Whether to retry. Priority from highest to lowest, each level can veto early:
 *   1. a per-request disable (`retry: false` or `retry: { enable: false }`) —
 *      the highest-priority veto
 *   2. the `methods` whitelist — a method outside it is vetoed outright, even if
 *      `shouldRetry` would say otherwise (mirrors ky: non-idempotent verbs aren't
 *      retried by default, and that can't be overridden by a custom check, guarding
 *      against duplicate side effects like a double POST/PATCH from one bad call)
 *   3. `shouldRetry?.(response?, err?) ?? statusCodes.includes(status) ?? false` —
 *      an exact true/false wins outright, `undefined` falls through to the
 *      status-code table
 * (`config.retry === true` means "no override, respect the plugin defaults" — no
 * special-casing needed here, since it's neither a number nor an object, every
 * `$resolve*` naturally falls back to the plugin-level default anyway.)
 *
 * @internal
 */
export function $shouldRetry(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
  response?: AxiosResponse,
  err?: AxiosError,
): boolean {
  if ($isDisabled(config)) return false;
  const method = (config.method || "get").toLowerCase();
  if (!$resolveMethods(config, defaults).includes(method)) return false;
  const custom = $resolveShouldRetry(config, defaults);
  const status = response?.status ?? err?.status;
  return (
    custom?.(response, err) ??
    (typeof status === "number" &&
      $resolveStatusCodes(config, defaults).includes(status)) ??
    false
  );
}

/** `statusCodes` 的默认值：常见"值得重试"的状态码，排除 501（对齐 Dio 默认 retryIf） / default `statusCodes`: commonly "worth retrying" statuses, excluding 501 (mirrors Dio's default retryIf). */
const DEFAULT_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/** `afterStatusCodes` 的默认值：Retry-After 头标准语义适用的状态码（限流/"稍后重试"），对齐 ky / default `afterStatusCodes`: statuses where a Retry-After header carries its standard meaning (rate-limit/"retry later"), mirrors ky. */
const DEFAULT_AFTER_STATUS_CODES = [413, 429, 503];

/** `methods` 的默认值：幂等/安全重放的动词，不含 post/patch（对齐 ky，防止误重试造成重复副作用） / default `methods`: idempotent/safe-to-replay verbs, excluding post/patch (mirrors ky, guarding against duplicate side effects from an accidental retry). */
const DEFAULT_METHODS = ["get", "put", "head", "delete", "options", "trace"];

/** 解析是否尊重服务端 `Retry-After`：请求级 > 插件级 > 默认 true / resolves whether to respect the server's `Retry-After`: request-level > plugin-level > default true. @internal */
export function $resolveRespectRetryAfter(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): boolean {
  const v = config.retry;
  if (typeof v === "object" && v && typeof v.respectRetryAfter === "boolean")
    return v.respectRetryAfter;
  return defaults.respectRetryAfter ?? true;
}

/** 解析 `Retry-After` 换算出的等待上限：请求级 > 插件级 > 默认不封顶 / resolves the cap on a `Retry-After`-derived wait: request-level > plugin-level > uncapped by default. @internal */
export function $resolveRetryAfterMax(
  config: AxiosRequestConfig,
  defaults: IRetryOptions,
): number {
  const v = config.retry;
  if (typeof v === "object" && v && typeof v.retryAfterMax === "number")
    return v.retryAfterMax;
  return defaults.retryAfterMax ?? Infinity;
}

/**
 * 从响应的 `Retry-After` 头换算出等待毫秒数（服务端说的优先于本插件算出来的 delay）：
 * 数字按秒算；否则按 HTTP-date 解析（`Date.parse` 原生支持 IMF-fixdate 格式）。解析
 * 不出来或没有该头 → undefined（回退到 `delay`）。参考 ky 的 `Retry-After` 支持，未
 * 复刻它额外的 `RateLimit-Reset` 系列头和过时日期格式的兼容（场景太窄）。
 *
 * Converts a response's `Retry-After` header into a wait in ms (server-provided
 * timing wins over this plugin's computed `delay`): a number is seconds;
 * otherwise parsed as an HTTP-date (`Date.parse` natively handles IMF-fixdate).
 * Unparsable or missing → `undefined` (falls back to `delay`). Mirrors ky's
 * `Retry-After` support; doesn't replicate its extra `RateLimit-Reset`-family
 * headers or legacy date-format fallbacks (too narrow a use case here).
 *
 * @internal
 */
function $retryAfterMs(
  response: AxiosResponse | undefined,
  cap: number,
): number | undefined {
  const h = response?.headers as
    | { get?: (n: string) => unknown; "retry-after"?: unknown }
    | undefined;
  const raw = (
    typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"]
  ) as string | undefined;
  if (raw == null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds))
    return Math.min(cap, Math.max(0, seconds * 1000));
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.min(cap, Math.max(0, timestamp - Date.now()));
}

/** 把 `delay` 解析成本次等待的毫秒数：函数返回非 number 视为 0 / resolves `delay` into this attempt's wait in ms: a non-number function return counts as 0. @internal */
function $computeDelay(
  delayOpt: TRetryDelay,
  current: number,
  max: number,
  response?: AxiosResponse,
  err?: AxiosError,
): number {
  if (typeof delayOpt === "number") return delayOpt;
  const r = delayOpt(current, max, response, err);
  return typeof r === "number" ? r : 0;
}

/** 判定响应/错误是否该重试；返回明确的 true/false 会覆盖默认判断，返回 undefined/void 则回退到 statusCodes 表 / predicate deciding whether a response/error should be retried; an exact true/false overrides the default check, undefined/void falls through to the `statusCodes` table. */
export type TShouldRetry = (
  response?: AxiosResponse,
  err?: AxiosError,
) => boolean | undefined | void;

/** 重试前的等待时长；函数形式按 (当前次数, 最大次数, 响应?, 错误?) 计算，返回非 number 视为 0 / wait duration before a retry; the function form computes from (current attempt, max, response?, err?), a non-number return counts as 0. */
export type TRetryDelay =
  | number
  | ((
      current: number,
      max: number,
      response?: AxiosResponse,
      err?: AxiosError,
    ) => number | false | void | undefined | null);

/** 给 delay 加抖动：`true` → 在 [0, delay) 内随机；函数 → 自行算出抖动后的值 / jitters `delay`: `true` → uniformly random within [0, delay); a function → computes the jittered value itself. */
export type TJitter = true | ((delay: number) => number);

export interface IRetryOptions {
  /** 插件级总开关，默认 true；设为 false 时整个插件不安装 / plugin-level master switch, defaults to true; false skips installing the plugin entirely. */
  enable?: boolean;
  /** 默认最大重试次数，可由请求级 config.retry 覆盖，默认 0（不重试） / default max retry count, overridable by request-level config.retry, defaults to 0 (no retries). */
  max?: number;
  /** 允许重试的方法白名单（不区分大小写），硬性否决、shouldRetry 说了也不算，默认幂等动词（不含 post/patch） / whitelist of methods eligible for retry (case-insensitive); a hard veto that `shouldRetry` cannot override, defaults to idempotent verbs (excludes post/patch). */
  methods?: string[];
  /** 判断是否该重试；返回明确 true/false 就采用，返回 undefined 才退回 statusCodes 表 / decides whether to retry; an exact true/false is taken as-is, `undefined` falls back to `statusCodes`. */
  shouldRetry?: TShouldRetry;
  /** shouldRetry 未给出明确结果时用的状态码表，默认 [408,429,500,502,503,504] / status codes used when `shouldRetry` doesn't give an exact result, defaults to [408,429,500,502,503,504]. */
  statusCodes?: number[];
  /** 重试前的等待时长，默认 3000ms（响应带 Retry-After 时被其覆盖） / wait duration before a retry, defaults to 3000ms (overridden by a response's Retry-After, if present). */
  delay?: TRetryDelay;
  /** 给 `delay` 加抖动的策略，默认不抖动（对齐 ky 的 jitter，Retry-After 场景下不生效） / jitter strategy applied to `delay`, no jitter by default (mirrors ky's `jitter`; does not apply when a Retry-After timing is used). */
  jitter?: TJitter;
  /** `delay`（含抖动后）的封顶值，默认不封顶（对齐 ky 的 backoffLimit，Retry-After 场景下不生效） / cap on `delay` (after jitter), uncapped by default (mirrors ky's `backoffLimit`; does not apply when a Retry-After timing is used). */
  delayMax?: number;
  /** 是否尊重响应的 `Retry-After` 头（数字秒或 HTTP-date），默认 true / whether to respect a response's `Retry-After` header (seconds or an HTTP-date), defaults to true. */
  respectRetryAfter?: boolean;
  /** 只在这些状态码上信 Retry-After 头（其它状态码即使带了也不认，照样走计算出的 delay），默认 [413,429,503]，对齐 ky / only trusts the Retry-After header for these statuses (others ignore it even if present, falling back to the computed delay), defaults to [413,429,503], mirrors ky. */
  afterStatusCodes?: number[];
  /** `Retry-After` 换算出的等待上限（毫秒），默认不封顶 / cap (ms) on a `Retry-After`-derived wait, uncapped by default. */
  retryAfterMax?: number;
}

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * 失败重试配置 / retry-on-failure config:
     *   - number → 设置最大重试次数 / sets the max retry count
     *   - false → 本次请求禁用重试（硬性否决，优先级最高） / disables retry for this request (a hard veto, highest priority)
     *   - true → 不覆盖，尊重插件级默认行为 / no override — respects the plugin-level defaults
     *   - IRetryOptions → 按字段覆盖插件级默认，未给的字段各自回退 / per-field override of the plugin defaults; any field left unset falls back on its own
     *   - 未指定 → 同 true，走插件级默认 / unspecified → same as `true`, falls back to the plugin-level default
     */
    retry?: number | boolean | IRetryOptions;
  }
}
