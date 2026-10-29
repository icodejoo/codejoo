import { UI_OBSERVER } from "../helpers/ui";
import { failureOf } from "../../src/response";
/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import type { AxpResponse } from "../../src/response";
import { AxiosError } from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import axpNotify from "../../src/plugins/notify";
import { notifyRecorder, uiClient } from "../helpers/ui";

/** 自定义格式化返回空消息的地址。 */
const EMPTY_MESSAGE_URL = "/empty";

/** 消息规则用假网络与假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 非空业务提示。 */
const MESSAGE = "业务失败";
/** 通知插件名称。 */
const NAME = "axp:notify";

it("[notify.cb.defaultStringify] 成功不提示，业务消息优先，缺消息回退失败类型或 HTTP 状态", /** 默认消息规则。 */ async () => {
  const h = uiClient();
  const record = notifyRecorder(h.events);
  const notify = vi.fn(record);
  h.api.use(axpNotify<AxpResponse>({ notify }));
  for (const [status, data, expected] of [
    [200, { code: 0, data: 1 }, undefined],
    [200, { code: 403, data: null, message: MESSAGE }, MESSAGE],
    [500, {}, "status 500"],
  ] as const) {
    h.net.fallback(/** 当前场景的信封。 */ () => ({ status, data }));
    const before = notify.mock.calls.length;
    const pending = h.send();
    await vi.runAllTimersAsync();
    const response = await pending;
    if (expected) expect(notify).toHaveBeenLastCalledWith(expected, response);
    expect(notify.mock.calls.length - before).toBe(expected ? 1 : 0);
  }
});

it("[notify.req.notify][notify.req.silent] 请求关闭与 silent 默认静默，卸载停止通知", /** 请求级开关保留在请求上。 */ async () => {
  const h = uiClient();
  const notify = vi.fn(notifyRecorder(h.events));
  h.api.use(axpNotify<AxpResponse>({ notify }));
  h.net.fallback(/** 失败供静默规则判断。 */ () => ({ status: 500 }));
  for (const config of [{ notify: false }, { notify: { enable: false } }, { silent: true }, { notify: null }, {}]) {
    const pending = h.send(config);
    await vi.runAllTimersAsync();
    await pending;
    expect(h.requests[h.requests.length - 1].notify).toEqual(config.notify);
  }
  expect(notify).toHaveBeenCalledTimes(2);
  expect(h.api.inspect().filter(/** 排除夹具自身的上下文观测层。 */ (item) => item.name !== UI_OBSERVER)).toEqual([{ name: NAME, stage: "outer" }]);
  h.api.eject(NAME);
  const pending = h.send();
  await vi.runAllTimersAsync();
  await pending;
  expect(notify).toHaveBeenCalledTimes(2);
});

it("[notify.cb.stringify] 自定义收到 r 和 ctx，可为成功生成消息或返回空串", /** 自定义扩展点和身份。 */ async () => {
  const h = uiClient();
  const notify = vi.fn(notifyRecorder(h.events));
  const contexts: unknown[] = [];
  const stringify = vi.fn(
    /** 保存根请求选项并生成自定义成功提示。 */ (r, ctx) => {
      contexts.push(ctx.request.silent);
      return r.request.url === EMPTY_MESSAGE_URL ? "" : MESSAGE;
    },
  );
  const plugin = axpNotify<AxpResponse>({ notify, stringify });
  expect(plugin.name).toBe(NAME);
  h.api.use(plugin);
  for (const config of [{ silent: true }, { silent: false }, { url: EMPTY_MESSAGE_URL }]) {
    const pending = h.send(config);
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(stringify.mock.calls[stringify.mock.calls.length - 1]?.[0]).toBe(response);
  }
  expect(contexts).toEqual([true, false, undefined]);
  expect(notify).toHaveBeenCalledTimes(2);
});

it("[notify.cb.network] 无 HTTP 响应时 r.status 为零且仍传给 stringify", /** 网络异常归一化。 */ async () => {
  const h = uiClient([], {}, /** 标准网络错误。 */ () => Promise.reject(new AxiosError("offline", "ERR_NETWORK")));
  const notify = vi.fn(notifyRecorder(h.events));
  const stringify = vi.fn(/** 从统一响应生成网络消息。 */ (r) => `${failureOf(r)?.type} ${r.status}`);
  h.api.use(axpNotify<AxpResponse>({ notify, stringify }));
  const response = await h.send();
  expect(failureOf(response)?.type).toBe("network");
  expect(notify).toHaveBeenCalledWith("network 0", response);
  expect(stringify.mock.calls[0]?.[0]).toBe(response);
});
