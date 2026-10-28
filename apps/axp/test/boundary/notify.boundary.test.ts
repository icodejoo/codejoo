/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import type { AxpResponse } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpNotify from "../../src/plugins/notify";
import { notifyRecorder, uiClient } from "../helpers/ui";

/** 消息生成故障模式。 */
const STRINGIFY_FAILURE = "stringify";
/** 异步通知拒绝模式。 */
const ASYNC_FAILURE = "reject";
/** 无消息的空文本。 */
const EMPTY_TEXT = "";
/** 生命周期检查使用的消息。 */
const CUSTOM_MESSAGE = "m";

/** 回调边界全部在假时钟下验证。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 通知故障样例。 */
const BUG = new Error("notify bug");
/** 通知插件名称。 */
const NAME = "axp:notify";

it.each([STRINGIFY_FAILURE, "notify", ASYNC_FAILURE])(
  "[notify.cb.error] %s 故障不改变成功和 HTTP 失败，console.error 每故障一次",
  /** 两类同步回调与异步通知错误。 */ async (source) => {
    const error = vi.spyOn(console, "error").mockImplementation(/** 隔离预期日志。 */ () => {});
    const h = uiClient();
    const record = notifyRecorder(h.events);
    h.api.use(
      axpNotify<AxpResponse>({
        stringify: /** 模拟消息生成失败。 */ () => {
          if (source === STRINGIFY_FAILURE) throw BUG;
          return "message";
        },
        notify: /** 先记录真实通知再模拟 UI 故障。 */ (message, r) => {
          record(message, r);
          if (source === ASYNC_FAILURE) return Promise.reject(BUG);
          throw BUG;
        },
      }),
    );
    for (const status of [200, 500]) {
      h.net.fallback(/** 成功与失败都保持原结果。 */ () => ({ status }));
      const before = error.mock.calls.length;
      const pending = h.send();
      await vi.runAllTimersAsync();
      expect((await pending).httpStatus).toBe(status);
      expect(error.mock.calls.length - before).toBe(1);
      expect(error.mock.calls[before]?.[1]).toBe(BUG);
    }
  },
);

it.each([EMPTY_TEXT, undefined, null, false, 0, "   "])(
  "[notify.cb.message] stringify 返回 %s，空白非空消息不 trim",
  /** 运行时非法 falsy 沿用不提示边界。 */ async (message) => {
    const h = uiClient();
    const notify = vi.fn(notifyRecorder(h.events));
    h.api.use(
      axpNotify<AxpResponse>({
        notify,
        stringify: /** 模拟 JS 调用者返回值。 */ () => message as string,
      }),
    );
    const pending = h.send();
    await vi.runAllTimersAsync();
    await pending;
    expect(notify).toHaveBeenCalledTimes(message ? 1 : 0);
  },
);

it("[notify.cb.cancel] 在途取消默认不通知且监听释放", /** cancel 分类跳过通知。 */ async () => {
  const h = uiClient();
  const notify = vi.fn(notifyRecorder(h.events));
  h.api.use(axpNotify<AxpResponse>({ notify }));
  const pending = h.send();
  expect(h.api.cancelAll()).toBe(1);
  await vi.runAllTimersAsync();
  expect((await pending).kind).toBe("cancel");
  expect(notify).not.toHaveBeenCalled();
});

it("[notify.opt.enable][notify.method.lifecycle] 禁用不 setup，重名拒绝，卸载重装不重复通知", /** 生命周期的新契约。 */ async () => {
  const h = uiClient();
  const notify = vi.fn(notifyRecorder(h.events));
  const disabled = axpNotify<AxpResponse>({ enable: false, notify });
  h.api.use(disabled);
  expect(h.api.inspect()).toEqual([]);
  let pending = h.send({ notify: true });
  await vi.runAllTimersAsync();
  await pending;
  h.api.eject(NAME);
  const plugin = axpNotify<AxpResponse>({
    notify,
    stringify: /** 每个请求都可产生消息。 */ () => CUSTOM_MESSAGE,
  });
  h.api.use(plugin);
  expect(/** 同名安装必须拒绝。 */ () => h.api.use(plugin)).toThrow("Duplicate plugin");
  pending = h.send();
  await vi.runAllTimersAsync();
  await pending;
  expect(h.api.eject(NAME)).toBe(true);
  expect(h.api.eject(NAME)).toBe(false);
  h.api.use(plugin);
  pending = h.send();
  await vi.runAllTimersAsync();
  await pending;
  expect(notify).toHaveBeenCalledTimes(2);
});

it("[notify.cb.missing] 无 config、message、response 的网络错误使用默认类别状态消息", /** 缺少传输信息时仍有 R 契约。 */ async () => {
  const { AxiosError } = await import("axios");
  const h = uiClient([], {}, /** 空 AxiosError 不含请求和响应。 */ () => Promise.reject(new AxiosError()));
  const notify = vi.fn(notifyRecorder(h.events));
  h.api.use(axpNotify<AxpResponse>({ notify }));
  const response = await h.send();
  expect(response).toMatchObject({ kind: "network", status: 0, message: EMPTY_TEXT });
  expect(notify).toHaveBeenCalledExactlyOnceWith("network 0", response);
});
it("[notify.method.lifecycle] 同一插件定义复用时，卸载一个客户端不影响另一个", /** 客户端注册和副作用隔离。 */ async () => {
  const first = uiClient();
  const second = uiClient();
  const notify = vi.fn(notifyRecorder(first.events));
  const plugin = axpNotify<AxpResponse>({
    notify,
    stringify: /** 所有结果都产生一条消息。 */ () => CUSTOM_MESSAGE,
  });
  first.api.use(plugin);
  second.api.use(plugin);
  let pending = Promise.all([first.send(), second.send()]);
  await vi.runAllTimersAsync();
  await pending;
  expect(notify).toHaveBeenCalledTimes(2);
  first.api.eject(NAME);
  pending = Promise.all([first.send(), second.send()]);
  await vi.runAllTimersAsync();
  await pending;
  expect(notify).toHaveBeenCalledTimes(3);
  expect(second.api.inspect()).toEqual([{ stage: "outer", name: NAME }]);
});
it.each([undefined, null, false, 0, EMPTY_TEXT, true])(
  "[notify.req.silent] 自定义 stringify 读取原始 silent=%s，可自行决定通知",
  /** 默认格式化和自定义扩展点保持各自契约。 */ async (silent) => {
    const h = uiClient();
    const notify = vi.fn(notifyRecorder(h.events));
    const stringify = vi.fn(
      /** 验证本逻辑请求的原始选项。 */ (_r, ctx) => {
        expect(ctx.request.silent).toBe(silent);
        return "custom";
      },
    );
    h.api.use(axpNotify<AxpResponse>({ notify, stringify }));
    const pending = h.send({ silent: silent as boolean });
    await vi.runAllTimersAsync();
    await pending;
    expect(notify).toHaveBeenCalledTimes(1);
  },
);
