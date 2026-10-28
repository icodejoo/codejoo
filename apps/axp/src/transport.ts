import type { AxiosInstance, AxiosResponse } from "axios";
import { normalizeMethod } from "./methods";
import type { AxpContext } from "./context";
import { AXP_KINDS, type IAxpResponse, type IAxpResponseFactory } from "./response";
import { effectiveHeaders, HEADER_GROUPS, isPlainObject } from "./utils";
import type { AxpRequestConfig } from "./types";

/** 克隆失败的 debug 提示。 */
const CLONE_WARNING = "[axp] 请求体无法克隆，回退原引用";

/** 所有 HTTP 状态均交给归一化响应判定。 */
const ACCEPT_HTTP_STATUS = () => true;

/** 按需复制请求体；缺少或失败的 structuredClone 回退原引用。 */
function cloneData<R extends IAxpResponse>(data: unknown, ctx: AxpContext<R>): unknown {
  try {
    if (typeof globalThis.structuredClone !== "function") {
      ctx.log.warn(CLONE_WARNING);
      return data;
    }
    return globalThis.structuredClone(data);
  } catch (error) {
    ctx.log.warn(CLONE_WARNING, error);
    return data;
  }
}

/** 为已删除的默认查询键补 null 禁用标记，防止二次合并恢复；特殊参数容器按原样传递。 */
function maskParams(params: unknown, defaults: unknown): unknown {
  if (!isPlainObject(defaults) || (params !== undefined && !isPlainObject(params))) return params;
  const current = params ?? {};
  const masked: Record<string, unknown> = { ...current };
  for (const key of Object.keys(defaults)) {
    masked[key] = Object.prototype.hasOwnProperty.call(current, key) ? maskParams(current[key], defaults[key]) : null;
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
 * axios 还会自行合并一次 defaults，交出完整视图会让那次合并按全部字段计费，交差量则回到原始成本，结果等价。
 * 层改动过的 params / headers 带上掩码，防止被二次合并带回已删除的默认值。
 */
function toWire<R extends IAxpResponse>(ctx: AxpContext<R>, axios: AxiosInstance): AxpRequestConfig {
  const current = ctx.request as Record<string, unknown>;
  const wire: Record<string, unknown> = { ...ctx.originRequest };
  const touched = ctx.touchedFields;
  if (!touched?.size) return wire as AxpRequestConfig;
  for (const key of touched) {
    wire[key] = key in current ? current[key] : undefined;
  }
  if (touched.has("params")) wire.params = maskParams(current.params, axios.defaults.params);
  if (touched.has("headers")) wire.headers = maskHeaders(ctx.request, axios.defaults);
  return wire as AxpRequestConfig;
}

/** 建立传输边界；HTTP 状态全放行，归一化交给响应工厂。
 * @param axios 底层 axios 实例。
 * @param factory 当前客户端的响应工厂。
 * @returns 产出统一响应的传输函数。
 * @example `const send = createTransport(axios, axpResponse())`
 */
export function createTransport<R extends IAxpResponse>(axios: AxiosInstance, factory: IAxpResponseFactory<R>): (ctx: AxpContext<R>) => Promise<R> {
  return /** 网络与请求准备异常统一交给已保护的工厂分类。 */ async (ctx) => {
    let response: AxiosResponse;
    try {
      const signal = ctx.request.signal ?? ctx.signal;
      if (signal.aborted) return ctx.fail({ kind: AXP_KINDS.CANCEL });
      const request = toWire(ctx, axios);
      request.signal = signal;
      if (ctx.replayable && (Array.isArray(request.data) || isPlainObject(request.data))) request.data = cloneData(request.data, ctx);
      request.validateStatus = ACCEPT_HTTP_STATUS;
      response = await axios.request(request);
    } catch (error) {
      return factory.fromError(error, ctx);
    }
    return factory.fromResponse(response, ctx);
  };
}
