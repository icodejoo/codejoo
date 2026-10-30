import { isAxiosError, isCancel, type AxiosInstance, type AxiosResponse } from "axios";
import { fingerprintOf } from "./key";
import { normalizeMethod } from "./methods";
import type { AxpContext } from "./context";
import { AXP_FAILURES } from "./brand";
import type { AxpFailureType, IAxpResponse, IAxpResponseFactory } from "./response";
import { effectiveHeaders, hasOwn, HEADER_GROUPS, isPlainObject } from "./utils";
import type { AxpRequestConfig } from "./types";

/** 已提示原地修改的请求体，跨重放和逻辑请求去重。 */
const warnedBodies = new WeakSet<object>();

/** 所有 HTTP 状态均交给归一化响应判定。 */
const ACCEPT_HTTP_STATUS = () => true;

/** 按传输事实分类，工厂无法改写规则。
 * @internal
 * @param error 原始传输异常。
 * @returns 内核失败类别。
 * @example `classifyError(new AxiosError('offline'))`
 */
export function classifyError(error: unknown): AxpFailureType {
  if (isCancel(error) || (error instanceof Error && error.name === "AbortError")) return AXP_FAILURES.CANCEL;
  if (!isAxiosError(error)) return AXP_FAILURES.INTERNAL;
  if (error.code === "ETIMEDOUT" || (error.code === "ECONNABORTED" && /timeout/i.test(error.message))) return AXP_FAILURES.TIMEOUT;
  return error.code === "ERR_BAD_RESPONSE" && (error.name === "SyntaxError" || error.cause instanceof SyntaxError || error.message.startsWith("maxContentLength")) ? AXP_FAILURES.PARSE : AXP_FAILURES.NETWORK;
}

/** 为已删除的默认查询键补 null 禁用标记，防止二次合并恢复；特殊参数容器按原样传递。 */
function maskParams(params: unknown, defaults: unknown): unknown {
  if (!isPlainObject(defaults) || (params !== undefined && !isPlainObject(params))) return params;
  const current = params ?? {};
  const masked: Record<string, unknown> = { ...current };
  for (const key of Object.keys(defaults)) {
    masked[key] = hasOwn(current, key) ? maskParams(current[key], defaults[key]) : null;
  }
  return masked;
}

/** 用文档化的 false 标记禁止重装已删除默认头，不改变逻辑请求的头视图。 */
function maskHeaders(request: Readonly<AxpRequestConfig>, defaults: AxiosInstance["defaults"]) {
  const headers = effectiveHeaders(request);
  const source = defaults.headers;
  for (const group of [source.common, source[normalizeMethod(request.method)]]) {
    for (const name of Object.keys(group ?? {})) {
      if (!headers.has(name)) headers.set(name, false);
    }
  }
  for (const name of Object.keys(source)) {
    if (!HEADER_GROUPS.has(name) && !headers.has(name)) headers.set(name, false);
  }
  return headers;
}
/**
 * 组装交给 axios 的差量配置：以用户原始的请求级配置为底，只叠加各层改动过的字段。
 * 参与 key 的 method、baseURL、纯对象 params 固定为入口视图，其余默认字段仍以发送时为准。
 * params / 改动过的 headers 带上掩码，防止被二次合并带回已删除的默认值。
 */
function toWire<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>, axios: AxiosInstance): AxpRequestConfig {
  const current = ctx.request as Record<string, unknown>;
  const wire: Record<string, unknown> = { ...ctx.originRequest };
  const touched = ctx.touchedFields;
  if (touched?.size) {
    for (const key of touched) {
      wire[key] = key in current ? current[key] : undefined;
    }
    if (touched.has("headers")) wire.headers = maskHeaders(ctx.request, axios.defaults);
  }
  wire.method = current.method;
  wire.baseURL = current.baseURL ?? "";
  if (isPlainObject(axios.defaults.params) || touched?.has("params")) wire.params = maskParams(current.params, axios.defaults.params);
  return wire as AxpRequestConfig;
}

/** 建立传输边界；HTTP 状态全放行，归一化交给响应工厂。
 * @param axios 底层 axios 实例。
 * @param factory 当前客户端的响应工厂。
 * @returns 产出统一响应的传输函数。
 * @example `const send = createTransport(axios, axpResponse())`
 */
export function createTransport<R extends IAxpResponse<unknown, string | number>>(axios: AxiosInstance, factory: IAxpResponseFactory<R>): (ctx: AxpContext<R>) => Promise<R> {
  return /** 网络与请求准备异常统一交给已保护的工厂分类。 */ async (ctx) => {
    let response: AxiosResponse;
    try {
      const signal = ctx.request.signal ?? ctx.signal;
      if (signal.aborted) return ctx.fail({ failure: AXP_FAILURES.CANCEL });
      if (!ctx.canReplay()) return ctx.fail({ failure: AXP_FAILURES.INTERNAL, error: new Error("一次性请求体已发送，不能重放；重放前请先检查 ctx.canReplay()") });
      const request = toWire(ctx, axios);
      request.signal = signal;
      ctx.markBodySent(request.data);
      request.validateStatus = ACCEPT_HTTP_STATUS;
      const data = request.data;
      const before = ctx.debug && ctx.replayable && (Array.isArray(data) || isPlainObject(data)) ? fingerprintOf(data) : null;
      try {
        response = await axios.request(request);
      } finally {
        if (before !== null && fingerprintOf(data) !== before && !warnedBodies.has(data)) {
          warnedBodies.add(data);
          ctx.log.warn("[axp] 发送中请求体被原地修改（拦截器/transformRequest/调用方）；重放将携带修改，转换请返回新对象");
        }
      }
    } catch (error) {
      const result = factory.fromError(error, ctx);
      ctx.setNative(result, isAxiosError(error) ? error.response : undefined, error);
      return result;
    }
    const result = factory.fromResponse(response, ctx);
    ctx.setNative(result, response, undefined);
    return result;
  };
}
