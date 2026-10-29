import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, vi } from "vitest";
import { assertInvariants, createTestClient, recordEvents, type ITestEvents } from "./client";
import type { AxpClient, AxpOptions, AxpPlugin, AxpRequestConfig } from "../../src/types";
import type { AxpResponse, IAxpResponse } from "../../src/response";
import type { TLoadingFunc } from "../../src/plugins/loading";

/** 使用 UI 事件不变量的测试客户端。 */
type Fixture<R extends IAxpResponse> = ReturnType<typeof createTestClient<R>>;
/** 夹具的逻辑请求观测层名称。 */
export const UI_OBSERVER = "ui-context-observer";
/** 测试异步调用链上的逻辑信号，避免共享响应身份混淆计数。 */
const noticeSignals = new AsyncLocalStorage<AbortSignal>();
/** 当前用例建立的客户端与事件记录。 */
const fixtures: {
  /** 待回收客户端。 */ api: Pick<AxpClient, "pending" | "dispose">;
  /** 可观测事件。 */ events: ITestEvents;
}[] = [];

/** 建立可核对落定、显示、通知和监听释放的测试支撑。
 * @param plugins 插件定义。
 * @param options 内核选项。
 * @param transport 可选传输配置。
 * @returns 支撑对象，所有逻辑请求应通过 send 发起。
 * @example `const h = uiClient([axpLoading()]); await h.send()`
 */
export function uiClient<R extends IAxpResponse = AxpResponse>(plugins: readonly AxpPlugin<R, any>[] = [], options: AxpOptions<R> = {} as AxpOptions<R>, transport?: Parameters<typeof createTestClient>[2]) {
  const fixture = createTestClient<R>(plugins, options, transport);
  return observeUi(fixture);
}
/** 对现有客户端（包括 extend 的子客户端）登记不变量观测。
 * @param fixture 客户端、假网络和事件容器。
 * @returns 附带 send 方法的夹具。
 * @example `observeUi({ ...parent, api: parent.api.extend(), events: recordEvents() })`
 */
export function observeUi<R extends IAxpResponse>(fixture: Fixture<R>) {
  const { api, events } = fixture;
  fixtures.push({ api, events });
  const requests: Readonly<AxpRequestConfig>[] = [];
  api.eject(UI_OBSERVER);
  api.use({
    name: UI_OBSERVER,
    stage: "outer",
    enforce: "pre",
    /** 从最外层绑定逻辑信号，重试与共享的回调各自隔离。 */
    handle(ctx, next) {
      requests.push(ctx.request);
      return noticeSignals.run(ctx.signal, next);
    },
  });
  let sequence = 0;
  return {
    ...fixture,
    requests,
    /** 每次调用独立记录真实的落定和用户 signal 监听净数。 */
    async send(config: AxpRequestConfig = {}) {
      const id = ++sequence;
      const signal = config.signal ?? new AbortController().signal;
      const add = signal.addEventListener.bind(signal);
      const remove = signal.removeEventListener.bind(signal);
      vi.spyOn(signal, "addEventListener").mockImplementation(
        /** 记录逻辑取消监听。 */ (...args) => {
          events.listeners++;
          add(...args);
        },
      );
      vi.spyOn(signal, "removeEventListener").mockImplementation(
        /** 记录监听释放。 */ (...args) => {
          events.listeners--;
          remove(...args);
        },
      );
      events.settled.set(id, 0);
      try {
        return await api.request({
          url: `/ui/${id}`,
          ...config,
          signal,
          wrap: true,
          throws: config.throws ?? false,
        });
      } finally {
        events.settled.set(id, events.settled.get(id)! + 1);
      }
    },
  };
}
/** 按回调身份登记显示和隐藏序列。
 * @param events 事件容器。
 * @param key 回调标签。
 * @returns 可安装的显示回调。
 * @example `loadingRecorder(events, 'main')`
 */
export function loadingRecorder(events: ITestEvents, key = "main"): TLoadingFunc {
  const values: boolean[] = [];
  events.loading.set(key, values);
  return /** 保存每次可见性变更。 */ (visible) => {
    values.push(visible);
  };
}
/** 对同一逻辑请求累计通知次数。
 * @param events 事件容器。
 * @returns 消息通知回调。
 * @example `notifyRecorder(events)`
 */
export function notifyRecorder(events: ITestEvents) {
  const ids = new WeakMap<AbortSignal, number>();
  return /** 同一逻辑 signal 重复通知会触发 I4。 */ (_message: string, _response: AxpResponse) => {
    const signal = noticeSignals.getStore()!;
    const id = ids.get(signal);
    // 逻辑 signal 在各次尝试间保持身份，不能按中间响应分别计数。
    const key = id ?? events.notify.size + 1;
    ids.set(signal, key);
    events.notify.set(key, (events.notify.get(key) ?? 0) + 1);
  };
}
/** 每个 UI 用例结束时，先排空延迟通知，再检查 I1–I4 并销毁客户端。 */
afterEach(async () => {
  if (vi.isFakeTimers()) await vi.runAllTimersAsync();
  for (const { api, events } of fixtures.splice(0)) {
    assertInvariants(api, events);
    api.dispose();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

export { recordEvents };
