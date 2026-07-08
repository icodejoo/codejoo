
import type { Plugin } from '../types';
import { pluginLog, pluginError } from '../helper';
import type { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';


const name = 'axp:notify'

/**
 * 从响应/错误中提取一句消息转给 `notify`（如弹 toast）；移植自 dioman 的 `DiomanNotify`。响应侧和错误侧共用同一个 `stringify`，返回非空才真正触发。
 *   - `stringify` 抛错不会打断请求本身：外面包了 try/catch 吞掉，仍按原样 resolve/reject
 *     （dioman 包 try/catch 是为了防止 Dio 的 `handler.next()` 永远不被调用导致请求悬挂；axios 的 Promise 链没有这个问题，异常会自然传播到下一个拦截器——这里包 try/catch 纯粹是为了不让通知失败反噬一个原本成功的响应，理由不同但结论一样得包）
 *   - 不改写 response/error 本身，只做旁路副作用
 *
 * 已知坑（auth.ts 结构性问题，非本插件独有；retry.ts 已修复，不受影响）：装在 `auth` 之后时，一次被 auth 刷新重放恢复的请求，本插件会触发两次 notify。根因：`auth` 靠 `return axios.request(config)`（同一实例）恢复——axios 响应链是一条扁平 `.then()` 序列，被恢复（而非重新 throw）的值会流进同一条链的下一环，不是短路跳过，所以恢复后的响应会被处理两次（重发自己内部走完整链路一次，原链路在恢复点之后继续往下走一次，`notify` 排在恢复逻辑之后就会撞上第二次）。`normalize` 也会被撞两次，只是它是幂等检查看不出来；`notify` 因为有真实副作用才会被用户看见。`retry.ts` 现在改走一个裸的、不带任何拦截器的独立 axios 实例重发，永远不会重新进入本链，所以 retry 恢复的响应只触发一次 notify，不受此坑影响。这是 axp 现有 auth 设计的固有行为，本插件没法单独修，只能提前说明。
 *
 * Extracts a message from the response/error and hands it to `notify` (e.g. to pop a toast); ported from dioman's `DiomanNotify`. The response and error paths share one `stringify`, firing only when the result is non-empty.
 *   - A throw from `stringify` never breaks the request itself: wrapped in try/catch and swallowed, still resolving/rejecting exactly as it would have
 *     (dioman wraps it to prevent Dio's `handler.next()` from never being called, which would hang the whole request; axios's Promise chain has no such risk — an exception propagates naturally to the next interceptor. The try/catch here exists purely so a notify failure can't poison an otherwise-successful response — different reasoning, same conclusion: still has to be wrapped)
 *   - Never rewrites the response/error itself — a pure side-channel effect
 *
 * Known caveat (a structural issue in auth.ts, not unique to this plugin; retry.ts has been fixed and is unaffected): installed after `auth`, a request recovered by an auth-refresh replay triggers this plugin's `notify` TWICE. Root cause: `auth` recovers via `return axios.request(config)` (the same instance) — axios's response chain is one flat `.then()` sequence, so a recovered (rather than re-thrown) value flows into the NEXT link of the SAME chain instead of short-circuiting past it; the recovered response is processed once inside the resend's own full chain, and again as the original chain continues past the recovery point (`notify`, registered after that point, collides with this second pass). `normalize` gets hit twice too, but it's an idempotent check so it's invisible; `notify` has a real side effect so the user sees it. `retry.ts` now resends through a bare, interceptor-less standalone axios instance that never re-enters this chain, so a retry-recovered response only fires notify once and is unaffected. This is inherent to axp's current auth design and can't be fixed from this plugin alone — this is just an advance warning.
 *
 * @param options 插件配置，见 {@link INotifyOptions}，`notify`/`stringify` 均必填 / plugin options, see {@link INotifyOptions}, both `notify` and `stringify` are required
 */
export default function axpNotify<T = unknown>({ notify, stringify }: INotifyOptions<T>): Plugin {
  return {
    name,
    install(axios) {
      pluginLog(axios.defaults, `[${name}] enabled`);

      /** 收敛响应侧/错误侧的 stringify→notify 调用 / funnels the response-side and error-side stringify→notify calls into one path */
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

      const id = axios.interceptors.response.use(
        (response: AxiosResponse) => {
          try {
            convert(response, undefined, response.config);
          } catch (e) {
            pluginError(response.config, `[${name}] stringify/notify threw`, e);
          }
          return response;
        },
        (error: unknown) => {
          const err = error as AxiosError;
          try {
            convert(err.response, err.message, err.config ?? ({} as AxiosRequestConfig));
          } catch (e) {
            pluginError(err.config, `[${name}] stringify/notify threw`, e);
          }
          return Promise.reject(error);
        },
      );
      return () => { axios.interceptors.response.eject(id); };
    },
  };
}

export interface INotifyOptions<T = unknown> {
  /** 拿到非空消息时触发（比如弹 toast） / fires when a non-empty message is produced (e.g. to pop a toast) */
  notify: (message: string) => void;
  /** 响应/错误 → 一句消息，返回空字符串表示不通知；响应侧和错误侧共用同一个函数，`status`/`data` 为 0/undefined 通常意味着网络层错误 / response/error → a message string, empty means "don't notify"; shared by both paths — `status`/`data` of 0/undefined usually means a network-layer error */
  stringify: (data: T | undefined, message: string, status: number, config: AxiosRequestConfig) => string;
}
