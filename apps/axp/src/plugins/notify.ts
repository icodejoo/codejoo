import type { AxpContext } from "../context";
import { isEnabled, type AxpOption, type IPluginSwitch } from "../options";
import { failureOf, AXP_FAILURES, type AxpResponse, type IAxpResponse } from "../response";
import type { AxpPlugin } from "../types";
import { fireNotice } from "../utils";

/** 内置消息插件名称。 */
const NAME = "axp:notify";
/** 通知故障始终输出。 */
const CALLBACK_ERROR = `[${NAME}] stringify/notify 回调失败`;
/** 消息回调接收客户端原始响应类型。 */
export interface INotifyOptions<R extends IAxpResponse<unknown, string | number> = IAxpResponse> extends IPluginSwitch {
  /** 非空消息通知，异步拒绝同样隔离。 */
  notify: (message: string, response: R) => unknown;
  /**
   * 必传的消息格式化，仅在失败且非取消、非 silent 时调用；返回 falsy 或空串即不提示。
   * internal 失败内核不过滤，通常应返回 falsy 或自行处理。
   */
  stringify: (response: R, ctx: AxpContext<R>) => string | null | undefined | false;
}
/** 在 outer 阶段最多通知一次，原样透传最终响应；成功、取消、silent 不调用 stringify。
 * @param options 必填 notify 与 stringify 回调，可选 enable 开关。
 * @returns 不构造响应的消息插件。
 * @example `axpNotify({ stringify: (r) => failureOf(r)?.type === 'network' ? '网络异常' : r.status >= 500 ? '服务异常' : null, notify: (message) => toast(message) })`
 */
export default function axpNotify<R extends IAxpResponse<unknown, string | number> = AxpResponse>(options: INotifyOptions<R>): AxpPlugin<R> {
  const { stringify, notify } = options;
  return {
    name: NAME,
    enable: options.enable,
    stage: "outer",
    /** 内层重试和重放收敛之后才通知。 */
    async handle(ctx, next) {
      const response = await next();
      if (!isEnabled(ctx.request.notify) || response.ok || ctx.request.silent || failureOf(response)?.type === AXP_FAILURES.CANCEL) return response;
      fireNotice(
        /** 格式化和通知共享异常边界。 */ () => {
          const message = stringify(response, ctx);
          return message ? notify(message, response) : undefined;
        },
        CALLBACK_ERROR,
      );
      return response;
    },
  };
}

declare module "../types" {
  interface AxpRequestOptions {
    /** 关闭本次通知，空值沿用插件配置。 */
    notify?: AxpOption<IPluginSwitch>;
  }
}
