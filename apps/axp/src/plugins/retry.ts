/* eslint-disable no-await-in-loop -- 重试必须按序等待与发送，不能并行。 */
import { cancelIfAborted, type AxpContext } from "../context";
import { methodSet, normalizeMethod } from "../methods";
import { resolveOption, resolveRequestOption, type AxpOption, type IPluginSwitch } from "../options";
import { failureOf, AXP_FAILURES, type AxpFailureType, type AxpResponse, type IAxpResponse } from "../response";
import type { AxpPlugin } from "../types";
import { applyJitter, computeDelay, defaultDelay, DEFAULT_AFTER_STATUS_CODES, DEFAULT_DELAY_MAX, retryAfterMs, waitFor, type IRetryAfterHeaders, type TRetryDelay as TimingDelay, type TRetryJitter } from "./retry-timing";

/** 内置重试插件名。 */
const NAME = "axp:retry";
/** 用户回调不能覆盖的失败类别。 */
const NO_RETRY_KINDS = new Set<AxpFailureType>([AXP_FAILURES.CANCEL, AXP_FAILURES.AUTH, AXP_FAILURES.INTERNAL, AXP_FAILURES.PARSE]);
/** 首次失败后的重试判定，非布尔值沿用默认规则。
 * @example `const shouldRetry: TShouldRetry = r => r.status === 503`
 */
export type TShouldRetry<R extends IAxpResponse<unknown, string | number> = IAxpResponse> = (response: R, attempt: number, ctx: AxpContext<R>) => boolean | null | undefined | void;
/** 重试延迟策略，异常由内核按程序错误落定。
 * @example `const delay: TRetryDelay = attempt => attempt * 300`
 */
export type TRetryDelay<R extends IAxpResponse<unknown, string | number> = IAxpResponse> = TimingDelay<R>;
/** 每次尝试的重试策略。 */
export interface IRetryOptions<R extends IAxpResponse<unknown, string | number> = IAxpResponse> extends IPluginSwitch {
  /** 最大重试次数，默认两次。 */
  max?: number;
  /** 允许重试的方法，大小写不敏感；默认幂等方法。 */
  methods?: readonly string[];
  /** 按 HTTP 状态码匹配，数组整体替换。 */
  statusCodes?: readonly number[];
  /** 布尔结果优先于默认网络与状态规则。 */
  shouldRetry?: TShouldRetry<R>;
  /** 毫秒数或从一开始的指数退避函数。 */
  delay?: TRetryDelay<R>;
  /** 本地延迟的随机或自定义抖动。 */
  jitter?: TRetryJitter;
  /** 本地延迟上限，默认一万毫秒。 */
  delayMax?: number;
  /** 默认开启；传函数时仅由函数决定是否采信 Retry-After，忽略 afterStatusCodes。 */
  respectRetryAfter?: boolean | ((response: R) => boolean);
  /** respectRetryAfter 为布尔值时允许采信服务端等待时间的 HTTP 状态码。 */
  afterStatusCodes?: readonly number[];
  /** 服务端等待时间上限（毫秒），默认 60_000；超过就不重试，Infinity 表示永远照办。
   * 相对旧版语义变化：以前封顶后照样等待，现在超过上限直接返回本次响应。
   */
  retryAfterMax?: number;
}
/** 装配时补齐策略，请求期只合并明确覆盖。 */
const DEFAULTS = {
  max: 2,
  methods: ["get", "put", "head", "delete", "options", "trace"],
  statusCodes: [408, 429, 500, 502, 503, 504],
  delay: defaultDelay,
  delayMax: DEFAULT_DELAY_MAX,
  respectRetryAfter: true,
  afterStatusCodes: DEFAULT_AFTER_STATUS_CODES,
  retryAfterMax: 60_000,
};
/** 数字简写只覆盖重试预算，其它类型不认。 */
function shorthand(value: unknown): Pick<IRetryOptions, "max"> | undefined {
  return typeof value === "number" ? { max: value } : undefined;
}
/** 在 attempt 阶段重跑 credential/source，返回最后一次真实响应。
 * @param options 重试预算、判定和等待策略。
 * @returns 装上即生效的 attempt 插件。
 * @example `axpRetry({ max: 2, delay: 100 })`
 */
export default function axpRetry<R extends IAxpResponse<unknown, string | number> = AxpResponse>(options: IRetryOptions<R> = {}): AxpPlugin<R> {
  const base = resolveOption<IRetryOptions<R>, typeof DEFAULTS>(undefined, options, DEFAULTS);
  base.methods = base.methods.slice();
  base.statusCodes = base.statusCodes.slice();
  base.afterStatusCodes = base.afterStatusCodes.slice();
  const methods = methodSet(base.methods);
  return {
    name: NAME,
    enable: options.enable,
    stage: "attempt",
    /** 通知与落定留给外层，每轮只调用内层链。 */
    async handle(ctx, next) {
      const config = resolveRequestOption(ctx.request.retry, base, DEFAULTS, shorthand);
      if (!config) return next();
      const method = normalizeMethod(ctx.request.method);
      const allowed = config === base ? methods.has(method) : config.methods.some(/** 请求级列表仍按小写方法比较。 */ (candidate) => normalizeMethod(candidate) === method);
      if (!allowed) return next();
      ctx.markReplayable();
      let response = await next();
      for (let attempt = 1; attempt <= config.max; attempt++) {
        const failure = failureOf(response);
        if (failure && NO_RETRY_KINDS.has(failure.type)) return response;
        const decision = config.shouldRetry?.(response, attempt, ctx);
        const retry = typeof decision === "boolean" ? decision : failureOf(response)?.type === AXP_FAILURES.NETWORK || failureOf(response)?.type === AXP_FAILURES.TIMEOUT || config.statusCodes.includes(response.status);
        if (!retry) return response;
        if (!ctx.canReplay()) return response;
        const respect = typeof config.respectRetryAfter === "function" ? config.respectRetryAfter(response) : config.respectRetryAfter && config.afterStatusCodes.includes(response.status);
        const after = respect ? retryAfterMs(response.raw?.headers as IRetryAfterHeaders | undefined, config.retryAfterMax) : undefined;
        if (after === null) return response;
        const ms = after ?? applyJitter(computeDelay(config.delay, attempt, config.max, response), config.jitter, config.delayMax);
        await waitFor(ms, ctx.signal);
        const cancelled = cancelIfAborted(ctx);
        if (cancelled) return cancelled;
        if (!ctx.canReplay()) return response;
        response = await next();
      }
      return response;
    },
  };
}

declare module "../types" {
  interface AxpRequestOptions {
    /** 数字简写预算，布尔开关或逐字段覆盖策略。 */
    retry?: AxpOption<IRetryOptions<any>, number>;
  }
}
