import type { AxiosInstance, AxiosResponse } from "axios";
import type { AxpContext } from "./context";
import { AXP_KINDS, type IAxpResponse, type IAxpResponseFactory } from "./response";
import { isPlainObject } from "./utils";

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

/** 建立传输边界；HTTP 状态全放行，归一化交给响应工厂。
 * @param axios 底层 axios 实例。
 * @param factory 当前客户端的响应工厂。
 * @returns 产出统一响应的传输函数。
 * @example `const send = createTransport(axios, axpResponse())`
 */
export function createTransport<R extends IAxpResponse>(
  axios: AxiosInstance,
  factory: IAxpResponseFactory<R>,
): (ctx: AxpContext<R>) => Promise<R> {
  return /** 网络与请求准备异常统一交给已保护的工厂分类。 */ async (ctx) => {
    let response: AxiosResponse;
    try {
      const signal = ctx.request.signal ?? ctx.signal;
      if (signal.aborted) return ctx.fail({ kind: AXP_KINDS.CANCEL });
      const request = {
        ...ctx.request,
        signal,
        data:
          ctx.replayable && (Array.isArray(ctx.request.data) || isPlainObject(ctx.request.data))
            ? cloneData(ctx.request.data, ctx)
            : ctx.request.data,
        /** HTTP 错误不构造 AxiosError。 */
        validateStatus: ACCEPT_HTTP_STATUS,
      };
      response = await axios.request(request);
    } catch (error) {
      return factory.fromError(error, ctx);
    }
    return factory.fromResponse(response, ctx);
  };
}
