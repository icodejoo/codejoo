import { CanceledError, type AxiosAdapter } from "axios";
import { onTestFinished, vi } from "vitest";
import type { IAxpCacheEntry, IAxpCacheStore } from "../../src/plugins/cache";
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
export function sourceClient(plugins: readonly AxpPlugin<AxpResponse, any>[] = [], options: AxpOptions = {}, transport?: Parameters<typeof createTestClient>[2]) {
  return observeUi(createTestClient(plugins, options, transport));
}

/** 与 sourceClient 相同，但响应类型可自定义；observeUi 只按默认响应声明，这里在边界处收窄。
 * @param plugins 本次装配的插件。
 * @param options 必须带匹配的 response 工厂。
 * @returns 客户端、假网络、事件记录和 send，send 的结果按自定义 R 使用。
 * @example `const h = customSourceClient<TestResponse>([axpShare()], { response: customResponse() })`
 */
export function customSourceClient<R extends IAxpResponse>(plugins: readonly AxpPlugin<R, any>[], options: AxpOptions<R>) {
  const fixture = createTestClient<R>(plugins, options);
  const observed = observeUi(fixture as unknown as Parameters<typeof observeUi>[0]);
  return observed as unknown as Omit<typeof observed, "send"> & {
    /** 发出一个逻辑请求，落定为自定义响应。 */
    send(config?: AxpRequestConfig): Promise<R>;
  };
}

/** 带写入计数的内存缓存存储，用来确认哪几次响应真的写进了缓存。
 * @returns 可交给 axpCache 的存储、写入 spy 与底层条目表。
 * @example `const { store, set } = countingCacheStore(); axpCache({ store }); expect(set).toHaveBeenCalledOnce()`
 */
export function countingCacheStore() {
  const entries = new Map<string, IAxpCacheEntry<AxpResponse>>();
  const set = vi.fn(
    /** 记录一次写入。 */ (key: string, entry: IAxpCacheEntry<AxpResponse>) => {
      entries.set(key, entry);
    },
  );
  const store: IAxpCacheStore<AxpResponse> = {
    /** 读取条目。 */ get: (key) => entries.get(key),
    set,
    /** 删除条目。 */ delete: (key) => entries.delete(key),
    /** 清空条目。 */ clear: () => entries.clear(),
    /** 当前条目数。 */ get size() {
      return entries.size;
    },
  };
  return { store, set, entries };
}

/** 推进假时钟直到全部请求落定，再按传入顺序返回结果。
 * @param pending 已发出、尚未落定的请求。
 * @returns 各请求的落定结果。
 * @example `const [a, b] = await settleAll(h.send(config), h.send(config))`
 */
export async function settleAll<T>(...pending: Promise<T>[]): Promise<T[]> {
  // 先标记为已观察，避免推进时钟期间失败的请求被当成未处理拒绝。
  for (const item of pending) item.catch(/** 仅标记已观察。 */ () => undefined);
  await vi.runAllTimersAsync();
  return Promise.all(pending);
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
  // 经 Reflect.get 取原型方法并按方法类型标注：调用时都用 apply 显式传 this，不依赖当前绑定。
  const add: EventTarget["addEventListener"] = Reflect.get(proto, "addEventListener");
  const remove: EventTarget["removeEventListener"] = Reflect.get(proto, "removeEventListener");
  proto.addEventListener = /** 只统计 AbortSignal 的 abort 监听。 */ function (this: EventTarget, ...args: Parameters<typeof add>) {
    if (this instanceof AbortSignal && args[0] === "abort") net++;
    return add.apply(this, args);
  };
  proto.removeEventListener = /** 与注册对称。 */ function (this: EventTarget, ...args: Parameters<typeof remove>) {
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
