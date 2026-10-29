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
  /** 空串跳过通知，默认忽略成功、取消和 silent。 */
  stringify?: (response: R, ctx: AxpContext<R>) => string;
}
/** 从最终逻辑结果生成默认消息。 */
function defaultStringify<R extends IAxpResponse<unknown, string | number>>(response: R, ctx: AxpContext<R>): string {
  if (response.ok || failureOf(response)?.type === AXP_FAILURES.CANCEL || ctx.request.silent) return "";
  return response.message || failureOf(response)?.type || `status ${response.status}${response.code !== 0 ? ` code ${response.code}` : ""}`;
}
/** 在 outer 阶段最多通知一次，原样透传最终响应。
 * @param options 必填通知回调和可选消息格式化规则。
 * @returns 不构造响应的消息插件。
 * @example `axpNotify({ notify: message => toast(message) })`
 */
export default function axpNotify<R extends IAxpResponse<unknown, string | number> = AxpResponse>(options: INotifyOptions<R>): AxpPlugin<R> {
  const stringify = options.stringify ?? defaultStringify<R>;
  const notify = options.notify;
  return {
    name: NAME,
    enable: options.enable,
    stage: "outer",
    /** 内层重试和重放收敛之后才通知。 */
    async handle(ctx, next) {
      const response = await next();
      if (!isEnabled(ctx.request.notify)) return response;
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
