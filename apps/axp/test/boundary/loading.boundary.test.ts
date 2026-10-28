/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import { beforeEach, expect, it, vi } from "vitest";
import axpLoading from "../../src/plugins/loading";
import type { AxpRequestConfig } from "../../src/types";
import { loadingRecorder, observeUi, recordEvents, uiClient } from "../helpers/ui";

/** 同步故障模式。 */
const SYNC_FAILURE = "throw";
/** 等待显示的窗口。 */
const SHOW_WINDOW = "show";
/** 等待隐藏的窗口。 */
const HIDE_WINDOW = "hide";
/** 默认回调的事件标签。 */
const LOADING_LABEL = "main";
/** 底层传输故障模式。 */
const ADAPTER_FAILURE = "adapter";

/** 防闪烁与卸载竞态使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 故意抛出的原始异常。 */
const BUG = new Error("loading bug");
/** 显示插件的固定名称。 */
const NAME = "axp:loading";
/** 有在途时间的假传输配置。 */
const SLOW = { latency: 30 } as AxpRequestConfig;

it("[loading.opt.enable] 插件关闭不可被请求回调重新开启", /** 总开关不 setup、不进 inspect。 */ async () => {
  const fn = vi.fn();
  const plugin = axpLoading({ enable: false, loading: fn });
  const setup = vi.spyOn(plugin, "setup");
  const h = uiClient([plugin]);
  const pending = h.send({ loading: { enable: true, loading: fn } });
  await vi.runAllTimersAsync();
  await pending;
  expect(fn).not.toHaveBeenCalled();
  expect(setup).not.toHaveBeenCalled();
  expect(h.api.inspect()).toEqual([]);
});

it.each([SYNC_FAILURE, "reject"])(
  "[loading.cb.error] %s 隔离并始终 console.error，后续计数正常",
  /** 同步和异步通知错误。 */ async (mode) => {
    const error = vi.spyOn(console, "error").mockImplementation(/** 保持测试安静。 */ () => {});
    const h = uiClient();
    const record = loadingRecorder(h.events);
    const loading = vi.fn(
      /** 先记录事件再模拟 UI 故障。 */ (visible: boolean) => {
        record(visible);
        if (mode === SYNC_FAILURE) throw BUG;
        return Promise.reject(BUG);
      },
    );
    h.api.use(axpLoading({ loading }));
    for (const config of [{}, { loading }, { loading: { loading, delay: 5 } }]) {
      const before = error.mock.calls.length;
      const pending = h.send({ ...SLOW, ...config });
      await vi.runAllTimersAsync();
      expect((await pending).ok).toBe(true);
      expect(error.mock.calls.length - before).toBe(2);
      expect(error.mock.calls[before]?.[1]).toBe(BUG);
    }
  },
);

it.each([SHOW_WINDOW, HIDE_WINDOW, "inflight"])(
  "[loading.method.lifecycle] 卸载取消 %s 窗口，旧请求完成不再回调",
  /** 清理两个计时器和在途请求。 */ async (window) => {
    const h = uiClient();
    h.api.use(
      axpLoading({
        loading: loadingRecorder(h.events),
        delay: window === SHOW_WINDOW ? 10 : 0,
        delayClose: 10,
      }),
    );
    const pending = h.send(SLOW);
    if (window === HIDE_WINDOW) {
      await vi.advanceTimersByTimeAsync(30);
      await pending;
    }
    expect(h.api.eject(NAME)).toBe(true);
    const snapshot = [...h.events.loading.get(LOADING_LABEL)!];
    expect(h.api.eject(NAME)).toBe(false);
    await vi.runAllTimersAsync();
    await pending;
    expect(h.events.loading.get(LOADING_LABEL)).toEqual(snapshot);
    expect(vi.getTimerCount()).toBe(0);
    h.api.use(axpLoading({ loading: loadingRecorder(h.events, "fresh") }));
    const fresh = h.send();
    await vi.runAllTimersAsync();
    await fresh;
  },
);

it.each([ADAPTER_FAILURE, "transform"])(
  "[loading.cb.finally] %s 抛无 config 异常仍成对释放",
  /** 原始 bug 不泄漏计数。 */ async (source) => {
    const h = uiClient(
      [],
      {},
      source === ADAPTER_FAILURE
        ? /** 同步传输故障。 */ () => {
            throw BUG;
          }
        : {
            transformResponse: /** 用户转换器故障。 */ () => {
              throw BUG;
            },
          },
    );
    h.api.use(axpLoading({ loading: loadingRecorder(h.events) }));
    const assertion = expect(h.send()).rejects.toBe(BUG);
    await vi.runAllTimersAsync();
    await assertion;
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
  },
);

it("[loading.method.lifecycle] 同一定义装在父子客户端各自计数", /** extend 重新建立状态。 */ async () => {
  const parent = uiClient();
  const shared = loadingRecorder(parent.events);
  parent.api.use(axpLoading({ loading: shared }));
  const child = observeUi({ ...parent, api: parent.api.extend(), events: recordEvents() });
  const first = parent.send(SLOW);
  const second = child.send(SLOW);
  expect(parent.events.loading.get(LOADING_LABEL)).toEqual([true, true]);
  await vi.runAllTimersAsync();
  await Promise.all([first, second]);
  // 同一 UI 回调被两个客户端各自使用，分别检查每个客户端的一对。
  expect(parent.events.loading.get(LOADING_LABEL)).toEqual([true, true, false, false]);
  const observed = parent.events.loading.get(LOADING_LABEL)!;
  parent.events.loading.set(LOADING_LABEL, [observed[0], observed[2]]);
  child.events.loading.set(LOADING_LABEL, [observed[1], observed[3]]);
});
