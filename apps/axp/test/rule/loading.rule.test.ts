/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import { beforeEach, expect, it, vi } from "vitest";
import axpLoading from "../../src/plugins/loading";
import type { AxpRequestConfig } from "../../src/types";
import { loadingRecorder, recordEvents, uiClient } from "../helpers/ui";

/** 默认回调的事件标签。 */
const LOADING_LABEL = "main";
/** 内置显示插件名。 */
const NAME = "axp:loading";
/** 请求级回调的事件标签。 */
const CUSTOM_LABEL = "custom";
/** 并发失败请求的地址。 */
const FAILURE_URL = "/fail";

/** 显示规则统一使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 假网络读取的传输耗时。 */
const SLOW = { latency: 40 } as AxpRequestConfig;

it.each([200, 500])(
  "[loading.cb.loading] 最终状态 %i 均成对显示隐藏，选项透传",
  /** 成功和失败都清理。 */ async (status) => {
    const events = recordEvents();
    const loading = loadingRecorder(events);
    const plugin = axpLoading({ loading });
    const h = uiClient([plugin]);
    Object.assign(h.events, events);
    h.net.fallback(/** 固定最终状态。 */ () => ({ status }));
    const config = { loading: true };
    const pending = h.send(config);
    expect(events.loading.get(LOADING_LABEL)).toEqual([true]);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.status).toBe(status);
    expect(result.request.loading).toBe(true);
    expect(config).toEqual({ loading: true });
    expect(events.loading.get(LOADING_LABEL)).toEqual([true, false]);
    expect(plugin.name).toBe(NAME);
  },
);

it("[loading.req.loading] 四种写法、空值继承和缺少回调", /** 按请求选择回调和开关。 */ async () => {
  const h = uiClient();
  const main = loadingRecorder(h.events);
  const custom = loadingRecorder(h.events, CUSTOM_LABEL);
  h.api.use(axpLoading({ loading: main }));
  for (const loading of [undefined, null, true, custom, { loading: custom }, false, { enable: false }]) {
    const pending = h.send({ loading });
    await vi.runAllTimersAsync();
    await pending;
  }
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false, true, false, true, false]);
  expect(h.events.loading.get(CUSTOM_LABEL)).toEqual([true, false, true, false]);
  h.api.eject(NAME);
  h.api.use(axpLoading());
  for (const loading of [true, undefined]) {
    const pending = h.send({ loading });
    await vi.runAllTimersAsync();
    await pending;
  }
});

it("[loading.cb.concurrent] 并发同回调只显示一轮，各回调独立配对", /** 交错结束和失败不串计数。 */ async () => {
  const h = uiClient();
  const main = loadingRecorder(h.events);
  const custom = loadingRecorder(h.events, CUSTOM_LABEL);
  h.api.use(axpLoading({ loading: main }));
  h.net.on("get", FAILURE_URL, /** 并发失败。 */ () => ({ status: 500 }));
  const requests = [h.send(SLOW), h.send({ url: FAILURE_URL }), h.send({ loading: false }), h.send({ ...SLOW, loading: custom })];
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
  expect(h.events.loading.get(CUSTOM_LABEL)).toEqual([true]);
  await vi.runAllTimersAsync();
  await Promise.all(requests);
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
  expect(h.events.loading.get(CUSTOM_LABEL)).toEqual([true, false]);
  const again = h.send();
  await vi.runAllTimersAsync();
  await again;
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false, true, false]);
});

it.each([0, 40])(
  "[loading.opt.delay] 耗时 %i：短请求从不显示，长请求延迟显示",
  /** 显示窗口取消与触发。 */ async (latency) => {
    const h = uiClient();
    h.api.use(axpLoading({ loading: loadingRecorder(h.events), delay: 20 }));
    const pending = h.send({ latency } as AxpRequestConfig);
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(h.events.loading.get(LOADING_LABEL)).toEqual(latency ? [true] : []);
    await vi.runAllTimersAsync();
    await pending;
    expect(h.events.loading.get(LOADING_LABEL)).toEqual(latency ? [true, false] : []);
  },
);

it("[loading.opt.delayClose] 连续请求取消隐藏，最后一轮按结束请求的延迟关闭", /** 隐藏窗口防闪烁。 */ async () => {
  const h = uiClient();
  h.api.use(axpLoading({ loading: loadingRecorder(h.events), delayClose: 30 }));
  const first = h.send();
  await vi.advanceTimersByTimeAsync(1);
  await first;
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
  const second = h.send({ loading: { delay: 100, delayClose: 10 } });
  await vi.advanceTimersByTimeAsync(1);
  await second;
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
  await vi.advanceTimersByTimeAsync(10);
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
});

it.each([0, -1])(
  "[loading.req.delay] 请求级延迟 %i 覆盖插件长延迟",
  /** 零和负数即时切换。 */ async (delay) => {
    const h = uiClient();
    h.api.use(axpLoading({ loading: loadingRecorder(h.events), delay: 100, delayClose: 100 }));
    const pending = h.send({ loading: { delay, delayClose: delay } });
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true]);
    await vi.runAllTimersAsync();
    await pending;
    expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
  },
);
