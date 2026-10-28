/* eslint-disable no-await-in-loop -- 刷新后的重放必须按序执行。 */
import { stateKey, type AxpContext } from "../context";
import { normalizeMethod } from "../methods";
import type { ITokenManager } from "../objects/TokenManager";
import { resolveOption, type IPluginSwitch } from "../options";
import { AXP_KINDS, type AxpResponse, type IAxpResponse } from "../response";
import type { AxpPlugin, AxpRequestConfig, AxpRequestPatch } from "../types";
import { fireNotice } from "../utils";
import { compileMethods, compileUrlPatterns, pathnameOf } from "./auth-match";

/** 内置鉴权插件名。 */
const NAME = "axp:auth";
/** token 快照独立于自定义凭证头名。 */
const INJECTED_TOKEN = stateKey<string | undefined>("auth:injected-token");
/** 默认保护全部方法与路径。 */
const WILDCARD = "*";
/** 鉴权通知异常的统一输出。 */
const CALLBACK_ERROR = `[${NAME}] 鉴权通知回调失败`;
/** 刷新实现抛错时的调试日志，仅 debug 开启才输出。 */
const REFRESH_ERROR = `[${NAME}] onRefresh 抛错，按刷新失败处理`;
/** 逻辑请求取消事件。 */
const ABORT_EVENT = "abort";
/** 标准鉴权失败的逻辑状态。 */
const UNAUTHORIZED = 401;
/** 越权的逻辑状态。 */
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
export type TAuthFunc<T, R extends IAxpResponse = IAxpResponse> = (response: R, tm: ITokenManager) => T | Promise<T>;
/** 凭证注入与鉴权恢复选项。 */
export interface IAuthOptions<R extends IAxpResponse = IAxpResponse> extends IPluginSwitch {
  /** 持有当前会话的管理器。 */
  tokenManager: ITokenManager;
  /** 必填刷新实现，只有 false 和抛错算失败。 */
  onRefresh: TAuthFunc<unknown, R>;
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
const DEFAULTS = { methods: WILDCARD, urlPattern: WILDCARD, ready: defaultReady };
/** 按逻辑状态和本次注入快照判断是否需要刷新。
 * @param response 本次内层失败响应。
 * @param tm 当前会话管理器。
 * @param ctx 同一逻辑请求的状态。
 * @returns 五动作之一，与请求头的形态和名字无关。
 * @example `onFailure: defaultAuthFailure`
 */
export function defaultAuthFailure<R extends IAxpResponse>(response: R, tm: ITokenManager, ctx: AxpContext<R>): AuthFailureAction {
  if (response.status === UNAUTHORIZED) {
    const current = tm.accessToken;
    if (!current) return AuthFailureAction.Expired;
    return ctx.get(INJECTED_TOKEN) === current ? AuthFailureAction.Refresh : AuthFailureAction.Replay;
  }
  return response.status === FORBIDDEN ? AuthFailureAction.Deny : AuthFailureAction.Others;
}
/** 等待共享刷新时只取消当前等待者，始终释放监听。 */
async function waitRefresh(pending: Promise<boolean>, signal: AbortSignal): Promise<boolean | undefined> {
  if (signal.aborted) return undefined;
  let cancel!: () => void;
  const cancelled = new Promise<undefined>(
    /** 独立的取消承诺不会中断其他请求的刷新。 */ (resolve) => {
      cancel = () => resolve(undefined);
      signal.addEventListener(ABORT_EVENT, cancel, { once: true });
    },
  );
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener(ABORT_EVENT, cancel);
  }
}
/** 在每个客户端维护单飞刷新，凭证层至多重放一次。
 * @param options 会话管理器、刷新实现和通知回调。
 * @returns credential 阶段鉴权插件。
 * @example `axpAuth({ tokenManager, onRefresh, onAccessExpired })`
 */
export default function axpAuth<R extends IAxpResponse = AxpResponse>(options: IAuthOptions<R>): AxpPlugin<R> {
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
              let success: boolean;
              try {
                success = (await base.onRefresh(response, tm)) !== false;
              } catch (error) {
                ctx.log.warn(REFRESH_ERROR, error);
                success = false;
              }
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
      async function prepare(request: Readonly<AxpRequestConfig>) {
        let token = tm.accessToken;
        let patch = await base.ready(tm, request);
        for (let attempt = 1; token !== tm.accessToken && attempt < READY_STABLE_ATTEMPTS; attempt++) {
          token = tm.accessToken;
          patch = await base.ready(tm, request);
        }
        return { token, patch };
      }
      return {
        /** 公开请求不受刷新阻塞，保护判定只在当前尝试入口求值。 */
        async handle(ctx, next) {
          const request = ctx.request;
          const forced = request.protected;
          const decision = typeof forced === "boolean" ? forced : base.isProtected?.(request);
          const protectedRequest = typeof decision === "boolean" ? decision : matchMethod(normalizeMethod(request.method)) && matchUrl(pathnameOf(request.url ?? ""));
          if (!protectedRequest) return next();
          ctx.markReplayable();
          if (refreshing) {
            const success = await waitRefresh(refreshing, ctx.signal);
            if (success === undefined) return ctx.fail({ kind: AXP_KINDS.CANCEL });
            if (!success) return ctx.fail({ kind: AXP_KINDS.AUTH, reason: AuthFailureAction.Expired });
          }
          let replayed = false;
          while (true) {
            // 首发与每次重放前都确认本地仍有凭证：刷新期间登出时，在本地拒绝而不是发出无凭证的受保护请求
            if (!tm.accessToken) {
              const response = ctx.fail({ kind: AXP_KINDS.AUTH, reason: "unauthenticated" });
              fireNotice(denied, CALLBACK_ERROR, response, tm);
              return response;
            }
            const { token, patch } = await prepare(request);
            ctx.set(INJECTED_TOKEN, token);
            const response = await next(patch ?? undefined);
            if (response.ok || response.kind === AXP_KINDS.INTERNAL || response.kind === AXP_KINDS.CANCEL) return response;
            const action = base.onFailure ? await base.onFailure(response, tm, ctx) : defaultAuthFailure(response, tm, ctx);
            // 异步路由期间调用方已取消：以取消落定，不再按鉴权失败处理（避免为取消的请求弹提示）
            if (ctx.signal.aborted) return ctx.fail({ kind: AXP_KINDS.CANCEL });
            switch (action) {
              case AuthFailureAction.Refresh:
              case AuthFailureAction.Replay: {
                if (replayed || isExpired()) {
                  expire(response);
                  return ctx.fail({
                    kind: AXP_KINDS.AUTH,
                    reason: AuthFailureAction.Expired,
                    from: response,
                  });
                }
                if (action === AuthFailureAction.Refresh) {
                  const success = await waitRefresh(refresh(response, ctx), ctx.signal);
                  if (success === undefined) return ctx.fail({ kind: AXP_KINDS.CANCEL });
                  if (!success)
                    return ctx.fail({
                      kind: AXP_KINDS.AUTH,
                      reason: AuthFailureAction.Expired,
                      from: response,
                    });
                }
                replayed = true;
                break;
              }
              case AuthFailureAction.Deny:
                fireNotice(denied, CALLBACK_ERROR, response, tm);
                return ctx.fail({ kind: AXP_KINDS.AUTH, reason: "denied", from: response });
              case AuthFailureAction.Expired:
                expire(response);
                return ctx.fail({ kind: AXP_KINDS.AUTH, reason: action, from: response });
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
