
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';
import type { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';


const name = 'notify'

/**
 * 从响应体/错误中提取一句人类可读的消息，转给 `notify` 回调（比如弹一个
 * toast）。移植自 dioman 的 `DiomanNotify` ——响应侧和错误侧都会调用同一个
 * `stringify` 来算出消息，非空才真正触发 `notify`。
 *
 *   - **两条路径都覆盖**：`onFulfilled`（正常响应，可能仍是业务失败）和
 *     `onRejected`（HTTP/网络错误）都会调 `stringify`
 *   - **`stringify` 抛错不会打断请求本身**：本插件只是"顺手通知"的副作用，
 *     不该让通知逻辑的 bug 反过来污染一个本来成功的响应——用 try/catch 包住，
 *     吞掉后仍按原样 resolve/reject
 *     （注：dioman 那边包 try/catch 是为了防止 Dio 的 handler.next() 永远
 *     不被调用导致请求整个悬挂——axios 的 Promise 链没有这个问题，异常会
 *     自然传播到下一个拦截器；这里包 try/catch 纯粹是为了不让通知失败
 *     "反噬"一个原本正常的响应，理由不同，但结论一样得包）
 *   - **不改写响应/错误本身**：跟 normalize 一样，只做旁路副作用，`onFulfilled`
 *     原样返回 response，`onRejected` 原样 reject error
 *
 * **已知坑（retry.ts/auth.ts 结构性问题，非本插件独有）**：装在 `retry`（或
 * `auth`）之后的话，一次被 retry 重试成功 / auth 刷新重放成功 恢复的请求，
 * 本插件会触发两次 notify，不是一次。根因：`retry`/`auth` 的 onRejected 靠
 * `return ctx.axios.request(config)` 恢复——axios 的响应链是一条扁平
 * `.then()` 序列，被恢复（而非重新 throw）的值会流进同一条链的下一环，不是
 * 短路跳过。所以恢复后的响应会被处理两次：一次是重发自己内部走完整链路时，
 * 一次是原链路在 `retry`/`auth` "恢复"后继续往下走时（`notify` 排在它们之后
 * 就会撞上这第二次）。`normalize` 也会被撞两次，只是它是幂等检查，两次看不
 * 出来；`notify` 因为有真实副作用（弹 toast）才会被用户看见。这是 axp 现有
 * retry/auth 设计的固有行为，本插件没法单独修，只能提前说明。
 */
export default function notify<T = unknown>({ notify, stringify }: INotifyOptions<T>): Plugin {
  return {
    name,
    install(ctx) {
      if (__DEV__) ctx.logger.log(`${name} enabled`);
      ctx.response(
        (response: AxiosResponse) => {
          try {
            convert(response, undefined, response.config);
          } catch (e) {
            if (__DEV__) ctx.logger.error(`${name} stringify/notify threw`, e);
          }
          return response;
        },
        (error: unknown) => {
          const err = error as AxiosError;
          try {
            convert(err.response, err.message, err.config ?? ({} as AxiosRequestConfig));
          } catch (e) {
            if (__DEV__) ctx.logger.error(`${name} stringify/notify threw`, e);
          }
          return Promise.reject(error);
        },
      );

      function convert(
        r: AxiosResponse | undefined,
        message: string | undefined,
        config: AxiosRequestConfig,
      ): void {
        const text = stringify(
          r?.data as T | undefined,
          message ?? r?.statusText ?? '',
          r?.status ?? 0,
          r?.config ?? config,
        );
        if (text) notify(text);
      }
    },
  };
}

export interface INotifyOptions<T = unknown> {
  /** 拿到非空消息时触发（比如弹 toast）。 */
  notify: (message: string) => void;
  /** 响应/错误 → 一句消息；返回空字符串表示这次不通知。响应侧和错误侧共用
   *  同一个函数，靠参数区分：`status`/`data` 为 0/undefined 通常意味着网络层
   *  错误（没拿到 HTTP 响应）。 */
  stringify: (data: T | undefined, message: string, status: number, config: AxiosRequestConfig) => string;
}
