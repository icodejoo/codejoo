/* eslint-disable no-await-in-loop -- 刷新后的重放必须按序执行。 */
import { cancelIfAborted, stateKey, type AxpContext } from "../context";
import { normalizeMethod } from "../methods";
import type { ITokenManager } from "../objects/TokenManager";
import { resolveOption, type IPluginSwitch } from "../options";
import { failureOf, AXP_FAILURES, type AxpResponse, type IAxpResponse } from "../response";
import type { AxpPlugin, AxpRequestConfig, AxpRequestPatch } from "../types";
import { fireNotice, waitAbortable } from "../utils";
import { compileMethods, compileUrlPatterns, pathnameOf, WILDCARD } from "./auth-match";

/** 内置鉴权插件名。 */
const NAME = "axp:auth";
/** token 快照独立于自定义凭证头名。 */
const INJECTED_TOKEN = stateKey<string | undefined>("auth:injected-token");
/** 鉴权通知异常的统一输出。 */
const CALLBACK_ERROR = `[${NAME}] 鉴权通知回调失败`;
/** 刷新实现抛错时的调试日志，仅 debug 开启才输出。 */
const REFRESH_ERROR = `[${NAME}] onRefresh 抛错，按刷新失败处理`;
/** 刷新挂起时的调试日志，仅 debug 开启才输出。 */
const REFRESH_TIMEOUT = `[${NAME}] onRefresh 超时，按刷新失败处理`;
/** 默认刷新等待上限，避免刷新请求重入导致永久挂起。 */
const DEFAULT_REFRESH_TIMEOUT = 30_000;
/** 标准鉴权失败的 HTTP 状态。 */
const UNAUTHORIZED = 401;
/** 越权的 HTTP 状态。 */
const FORBIDDEN = 403;
/** 异步 ready 期间 token 被替换时，最多准备凭证的次数；超过就以最后一次为准，避免无限追赶。 */
const READY_STABLE_ATTEMPTS = 3;
/** 鉴权失败的五种路由动作。
 * @example `const action: AuthFailureAction = AuthFailureAction.Refresh`
 */
export const AuthFailureAction = {
  /** 刷新成功后重放。 */ Refresh: "refresh",
  /** 使用当前 token 直接重放。 */ Replay: "replay",
  /** 越权拒绝，保留会话。 */ Deny: "deny",
  /** 清除会话并通知过期。 */ Expired: "expired",
  /** 无关失败原样透传。 */ Others: "others",
} as const;
/** 路由动作的值类型。 */
export type AuthFailureAction = (typeof AuthFailureAction)[keyof typeof AuthFailureAction];
/** 响应通知与刷新函数的统一参数顺序。
 * @example `const expired: TAuthFunc<void> = (r, tm) => showLogin(r.message)`
 */
export type TAuthFunc<T, R extends IAxpResponse<unknown, string | number> = IAxpResponse> = (response: R, tm: ITokenManager) => T | Promise<T>;
/** 凭证注入与鉴权恢复选项。 */
export interface IAuthOptions<R extends IAxpResponse<unknown, string | number> = IAxpResponse> extends IPluginSwitch {
  /** 持有当前会话的管理器。 */
  tokenManager: ITokenManager;
  /** 必填刷新实现，返回 false、抛错或超时算失败。 */
  onRefresh: TAuthFunc<unknown, R>;
  /** 刷新等待上限（毫秒），默认 30_000；0 或 Infinity 表示不限时。
   * 超时按刷新失败处理，迟到的回调结果不再参与鉴权；回调自身的会话写入由调用方负责。
   * @example `refreshTimeout: 5_000`
   */
  refreshTimeout?: number;
  /** 必填过期通知，每轮会话最多一次。 */
  onAccessExpired: TAuthFunc<unknown, R>;
  /** 拒绝访问通知，缺省沿用过期通知。 */
  onAccessDenied?: TAuthFunc<unknown, R>;
  /** 判定类路由，异常按程序错误落定。 */
  onFailure?: (response: R, tm: ITokenManager, ctx: AxpContext<R>) => AuthFailureAction | null | undefined | void | Promise<AuthFailureAction | null | undefined | void>;
  /** 保护的方法列表或通配符，默认全部。 */
  methods?: string | readonly string[];
  /** 保护的 pathname 模式，支持否定模式。 */
  urlPattern?: string | readonly string[];
  /** 布尔结果作为保护判定终值。 */
  isProtected?: (request: Readonly<AxpRequestConfig>) => boolean | null | undefined | void;
  /** 返回传给内层的补丁，默认注入 Authorization。 */
  ready?: (tm: ITokenManager, request: Readonly<AxpRequestConfig>) => AxpRequestPatch | void | Promise<AxpRequestPatch | void>;
}
/** 默认凭证补丁不修改本层请求或调用方头对象。 */
function defaultReady(tm: ITokenManager): AxpRequestPatch {
  return { headers: { Authorization: tm.accessToken } };
}
/** 装配期补齐默认路由和凭证注入。 */
const DEFAULTS = { methods: WILDCARD, urlPattern: WILDCARD, ready: defaultReady, refreshTimeout: DEFAULT_REFRESH_TIMEOUT };
/** 按 HTTP 状态和本次注入快照判断是否需要刷新。
 * @param response 本次内层失败响应。
 * @param tm 当前会话管理器。
 * @param ctx 同一逻辑请求的状态。
 * @returns 五动作之一，与请求头的形态和名字无关。
 * @example `onFailure: defaultAuthFailure`
 */
export function defaultAuthFailure<R extends IAxpResponse<unknown, string | number>>(response: R, tm: ITokenManager, ctx: AxpContext<R>): AuthFailureAction {
  if (response.status === UNAUTHORIZED) {
    const current = tm.accessToken;
    if (!current) return AuthFailureAction.Expired;
    return ctx.get(INJECTED_TOKEN) === current ? AuthFailureAction.Refresh : AuthFailureAction.Replay;
  }
  return response.status === FORBIDDEN ? AuthFailureAction.Deny : AuthFailureAction.Others;
}
/** 构造过期失败；from 为触发它的原响应，没有原响应时省略。 */
function expiredFailure<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>, from?: R): R {
  return ctx.fail({ failure: AXP_FAILURES.AUTH, reason: AuthFailureAction.Expired, from });
}
/** 在每个客户端维护单飞刷新，凭证层至多重放一次。
 * @param options 会话管理器、刷新实现和通知回调。
 * @returns credential 阶段鉴权插件。
 * @example `axpAuth({ tokenManager, onRefresh, onAccessExpired })`
 */
export default function axpAuth<R extends IAxpResponse<unknown, string | number> = AxpResponse>(options: IAuthOptions<R>): AxpPlugin<R> {
  if (!options?.tokenManager) throw new Error(`[${NAME}] options.tokenManager is required`);
  if (typeof options.onRefresh !== "function") throw new Error(`[${NAME}] options.onRefresh is required`);
  if (typeof options.onAccessExpired !== "function") throw new Error(`[${NAME}] options.onAccessExpired is required`);
  const base = resolveOption<IAuthOptions<R>, typeof DEFAULTS>(undefined, options, DEFAULTS);
  const matchMethod = compileMethods(base.methods);
  const matchUrl = compileUrlPatterns(base.urlPattern);
  const tm = base.tokenManager;
  const denied = base.onAccessDenied ?? base.onAccessExpired;
  return {
    name: NAME,
    enable: options.enable,
    stage: "credential",
    /** 单飞与过期状态均归当前客户端所有。 */
    setup() {
      let refreshing: Promise<boolean> | undefined;
      let expired: { /** 清理后的会话快照，新 token 自动解除过期。 */ token: string | undefined } | undefined;
      /** 登录写入新 token 后解除上一轮过期状态。 */
      function isExpired(): boolean {
        if (expired && expired.token !== tm.accessToken) expired = undefined;
        return expired !== undefined;
      }
      /** 标记终态并隔离通知异常，清理后的快照阻止旧会话复活。 */
      function expire(response: R): void {
        if (isExpired()) return;
        tm.clear();
        expired = { token: tm.accessToken };
        fireNotice(base.onAccessExpired, CALLBACK_ERROR, response, tm);
      }
      /** 发起或加入共享刷新，同步抛错同样释放单飞状态；刷新抛错按失败处理，不算程序 bug。 */
      function refresh(response: R, ctx: AxpContext<R>): Promise<boolean> {
        if (refreshing) return refreshing;
        refreshing = Promise.resolve()
          .then(
            /** 先挂好单飞承诺，再运行用户刷新代码。 */ async () => {
              const token = tm.accessToken;
              let success: boolean;
              try {
                const pending = Promise.resolve(base.onRefresh(response, tm)).then(/** 先归一为布尔值，让 undefined 专门表示超时。 */ (value) => value !== false);
                const timeout = base.refreshTimeout === 0 || base.refreshTimeout === Infinity ? undefined : base.refreshTimeout;
                const result = await waitAbortable(pending, undefined, timeout);
                if (result === undefined) ctx.log.warn(REFRESH_TIMEOUT);
                success = result === true;
              } catch (error) {
                ctx.log.warn(REFRESH_ERROR, error);
                success = false;
              }
              if (!success && tm.accessToken !== token) return true;
              if (!success) expire(response);
              return success;
            },
          )
          .finally(
            /** 所有等待者共享同一轮结束。 */ () => {
              refreshing = undefined;
            },
          );
        return refreshing;
      }
      /** 准备凭证并记下实际使用的 token：异步 ready 期间 token 若被替换，就用新 token 重做，保证快照与注入一致。 */
      async function prepare(ctx: AxpContext<R>) {
        let token: string | undefined;
        let patch: AxpRequestPatch | void;
        let attempt = 0;
        do {
          token = tm.accessToken;
          const result = base.ready(tm, ctx.request);
          if (result && "then" in result) {
            const pending = Promise.resolve(result);
            // 回调可能同步取消后才交出拒绝承诺；waitAbortable 的已取消快路径不观察它。
            void pending.catch(/** 被放弃的拒绝也必须已观察；等待期间的异常仍由 waitAbortable 原样传出。 */ () => undefined);
            patch = await waitAbortable(pending, ctx.signal);
          } else patch = result;
          if (cancelIfAborted(ctx)) break;
        } while (token !== tm.accessToken && ++attempt < READY_STABLE_ATTEMPTS);
        return { token, patch };
      }
      /** 等待刷新结束：调用方取消返回 cancel 响应（只取消自己这一路，不中断别人的刷新），刷新失败返回过期失败，成功返回 undefined。 */
      async function joinRefresh(pending: Promise<boolean>, ctx: AxpContext<R>, from?: R): Promise<R | undefined> {
        const success = await waitAbortable(pending, ctx.signal);
        return cancelIfAborted(ctx) ?? (success ? undefined : expiredFailure(ctx, from));
      }
      return {
        /** 公开请求不受刷新阻塞，保护判定只在当前尝试入口求值。 */
        async handle(ctx, next) {
          const request = ctx.request;
          const forced = request.protected;
          const decision = typeof forced === "boolean" ? forced : base.isProtected?.(request);
          const protectedRequest = typeof decision === "boolean" ? decision : matchMethod(normalizeMethod(request.method)) && matchUrl(pathnameOf(request.url ?? ""));
          if (!protectedRequest) return cancelIfAborted(ctx) ?? next();
          ctx.markReplayable();
          if (refreshing) {
            const failure = await joinRefresh(refreshing, ctx);
            if (failure) return failure;
          }
          let replayed = false;
          while (true) {
            const cancelledBeforePrepare = cancelIfAborted(ctx);
            if (cancelledBeforePrepare) return cancelledBeforePrepare;
            // 首发与每次重放前都确认本地仍有凭证：刷新期间登出时，在本地拒绝而不是发出无凭证的受保护请求
            if (!tm.accessToken) {
              const response = ctx.fail({ failure: AXP_FAILURES.AUTH, reason: "unauthenticated" });
              fireNotice(denied, CALLBACK_ERROR, response, tm);
              return response;
            }
            const { token, patch } = await prepare(ctx);
            const cancelledBeforeSend = cancelIfAborted(ctx);
            if (cancelledBeforeSend) return cancelledBeforeSend;
            ctx.set(INJECTED_TOKEN, token);
            const response = await next(patch ?? undefined);
            if (response.ok || failureOf(response)?.type === AXP_FAILURES.INTERNAL || failureOf(response)?.type === AXP_FAILURES.CANCEL) return response;
            const route = base.onFailure ? base.onFailure(response, tm, ctx) : defaultAuthFailure(response, tm, ctx);
            let action: AuthFailureAction | null | undefined | void;
            if (route && typeof route === "object") {
              const pending = Promise.resolve(route);
              void pending.catch(/** 同步取消时同样观察回调迟到的拒绝。 */ () => undefined);
              action = await waitAbortable(pending, ctx.signal);
            } else action = route;
            // 异步路由期间调用方已取消：以取消落定，不再按鉴权失败处理（避免为取消的请求弹提示）
            const cancelled = cancelIfAborted(ctx);
            if (cancelled) return cancelled;
            switch (action) {
              case AuthFailureAction.Refresh:
              case AuthFailureAction.Replay: {
                if (!ctx.canReplay()) return response;
                if (replayed || isExpired()) {
                  expire(response);
                  return expiredFailure(ctx, response);
                }
                if (action === AuthFailureAction.Refresh) {
                  const failure = await joinRefresh(refresh(response, ctx), ctx, response);
                  if (failure) return failure;
                }
                replayed = true;
                break;
              }
              case AuthFailureAction.Deny:
                fireNotice(denied, CALLBACK_ERROR, response, tm);
                return ctx.fail({ failure: AXP_FAILURES.AUTH, reason: "denied", from: response });
              case AuthFailureAction.Expired:
                expire(response);
                return expiredFailure(ctx, response);
              default:
                return response;
            }
          }
        },
      };
    },
  };
}

/** 稳定公开工厂元信息。 */
Object.defineProperty(axpAuth, "name", { value: NAME, configurable: true });

declare module "../types" {
  interface AxpRequestOptions {
    /** 本次请求强制保护或公开，空值继承插件判定。 */
    protected?: boolean;
  }
}
