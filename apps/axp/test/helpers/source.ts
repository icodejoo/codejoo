import { CanceledError, type AxiosAdapter } from "axios";
import { onTestFinished } from "vitest";
import type { AxpResponse, IAxpResponse } from "../../src/response";
import type { AxpOptions, AxpPlugin, AxpRequestConfig } from "../../src/types";
import { createTestClient } from "./client";
import { observeUi } from "./ui";

/** 假网络的成功信封，业务码 0。 */
export function envelope(data: unknown, status = 200) {
  return { status, data: { code: 0, data } };
}

/** 建立带不变量观测的 source 阶段测试客户端；插件可带管理 API。
 * @param plugins 本次装配的插件。
 * @param options 内核选项。
 * @param transport 可选传输配置。
 * @returns 客户端、假网络、事件记录和 send。
 * @example `const h = sourceClient([axpCache()]); await h.send({ url: '/a', cache: true })`
 */
export function sourceClient(
  plugins: readonly AxpPlugin<AxpResponse, any>[] = [],
  options: AxpOptions = {},
  transport?: Parameters<typeof createTestClient>[2],
) {
  return observeUi(createTestClient<AxpResponse>(plugins, options, transport));
}

/** 与 sourceClient 相同，但响应类型可自定义；observeUi 只按默认响应声明，这里在边界处收窄。
 * @param plugins 本次装配的插件。
 * @param options 必须带匹配的 response 工厂。
 * @returns 客户端、假网络、事件记录和 send，send 的结果按自定义 R 使用。
 * @example `const h = customSourceClient<TestResponse>([axpShare()], { response: customResponse() })`
 */
export function customSourceClient<R extends IAxpResponse>(
  plugins: readonly AxpPlugin<R, any>[],
  options: AxpOptions<R>,
) {
  const fixture = createTestClient<R>(plugins, options);
  const observed = observeUi(fixture as unknown as Parameters<typeof observeUi>[0]);
  return observed as unknown as Omit<typeof observed, "send"> & {
    /** 发出一个逻辑请求，落定为自定义响应。 */
    send(config?: AxpRequestConfig): Promise<R>;
  };
}

/** 记录每次经过 source 阶段的请求视图，用来确认内层实际看到的开关与地址。
 * @param enforce pre 排在内置 source 插件之前，post 排在之后（默认）。
 * @returns 记录插件与已见请求。
 * @example `const rec = requestRecorder(); sourceClient([axpMock(), rec.plugin])`
 */
export function requestRecorder(enforce: "pre" | "post" = "post") {
  const seen: Readonly<AxpRequestConfig>[] = [];
  const plugin: AxpPlugin<AxpResponse> = {
    name: `recorder-${enforce}`,
    stage: "source",
    enforce,
    /** 只记录，不改写请求。 */
    async handle(ctx, next) {
      seen.push(ctx.request);
      return next();
    },
  };
  return { plugin, seen };
}

/** 统计全部 AbortSignal 上 abort 监听的净数，用于确认没有残留监听。
 * 直接替换原型方法而不用 vi.spyOn：ui.ts 会在信号实例上再挂 spy，两层 spy 会互相递归。
 * @returns 取净数的函数，用例结束时自动还原原型方法。
 * @example `const listeners = trackAbortListeners(); ... expect(listeners()).toBe(0)`
 */
export function trackAbortListeners(): () => number {
  let net = 0;
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = /** 只统计 AbortSignal 的 abort 监听。 */ function (
    this: EventTarget,
    ...args: Parameters<typeof add>
  ) {
    if (this instanceof AbortSignal && args[0] === "abort") net++;
    return add.apply(this, args);
  };
  proto.removeEventListener = /** 与注册对称。 */ function (
    this: EventTarget,
    ...args: Parameters<typeof remove>
  ) {
    if (this instanceof AbortSignal && args[0] === "abort") net--;
    return remove.apply(this, args);
  };
  onTestFinished(
    /** 还原原型方法。 */ () => {
      proto.addEventListener = add;
      proto.removeEventListener = remove;
    },
  );
  return /** 读取当前净数。 */ () => net;
}

/** 一次真实发送在适配器里留下的记录。 */
export interface IWireCall {
  /** 传给 axios 的信号。 */
  signal: AbortSignal | undefined;
  /** 传给 axios 的超时。 */
  timeout: number | undefined;
}

/** 会响应 signal 的适配器：中止时立即以取消失败，否则延迟后返回 `done-N`。
 * @param calls 接收每次发送记录的数组。
 * @param latency 成功前的延迟毫秒数。
 * @returns 可作为 transport 的 axios 适配器。
 * @example `sourceClient([axpShare()], {}, signalAdapter(calls))`
 */
export function signalAdapter(calls: IWireCall[], latency = 100): AxiosAdapter {
  return (config) =>
    new Promise((resolve, reject) => {
      const signal = config.signal as AbortSignal | undefined;
      calls.push({ signal, timeout: config.timeout });
      /** 中止：摘除自己的监听并以取消失败。 */
      function onAbort(): void {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(new CanceledError("aborted"));
      }
      const timer = setTimeout(
        /** 延迟到期：摘除监听，按发送序号返回成功信封。 */ () => {
          signal?.removeEventListener("abort", onAbort);
          resolve({
            status: 200,
            statusText: "",
            headers: {},
            config,
            data: { code: 0, data: `done-${calls.length}` },
          });
        },
        latency,
      );
      signal?.addEventListener("abort", onAbort);
    });
}
