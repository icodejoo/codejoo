import { UI_OBSERVER } from "../helpers/ui";
import { failureOf } from "../../src/response";
import { beforeEach, expect, it, vi } from "vitest";
import axpLoading from "../../src/plugins/loading";
import axpMock from "../../src/plugins/mock";
import { envelope, sourceClient } from "../helpers/source";
import { loadingRecorder } from "../helpers/ui";

/** loading 的防闪烁与探测时序统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 被 mock 的接口。 */
const REAL = "/real";
/** 默认回调的事件标签。 */
const LABEL = "main";

/** 装好 loading 与 mock；探测 404 回落真实接口。 */
function client(loadingOptions: { delay?: number } = {}) {
  const h = sourceClient([]);
  h.api.use(axpLoading({ loading: loadingRecorder(h.events, LABEL), ...loadingOptions }));
  h.api.use(axpMock({ enable: true, mockUrl: MOCK }));
  h.net.on("get", `${MOCK}${REAL}`, () => ({ status: 404 }));
  h.net.on("get", REAL, () => envelope("real"));
  return h;
}

it("[loading.cb.loading × mock.req.mock] 探测加回落是同一个逻辑请求：整个过程只有一对显示与隐藏", async () => {
  const h = client();
  const pending = h.send({ url: REAL, mock: true, latency: 10 } as never);
  await vi.runAllTimersAsync();
  expect((await pending).data).toBe("real");
  expect(h.events.loading.get(LABEL)).toEqual([true, false]);
  expect(h.net.calls("get", `${MOCK}${REAL}`)).toBe(1);
  expect(h.net.calls("get", REAL)).toBe(1);
});

it("[loading.opt.delay × mock.req.mock] 探测加回落在 delay 内完成：从未显示", async () => {
  const h = client({ delay: 1000 });
  const pending = h.send({ url: REAL, mock: true });
  await vi.runAllTimersAsync();
  expect((await pending).data).toBe("real");
  expect(h.events.loading.get(LABEL)).toEqual([]);
});

it("[loading.cb.loading × mock.req.mock] 探测期间取消：loading 照常成对结束，不发真实请求", async () => {
  const h = client();
  const controller = new AbortController();
  const pending = h.send({
    url: REAL,
    mock: true,
    latency: 20,
    signal: controller.signal,
  } as never);
  await vi.advanceTimersByTimeAsync(5);
  controller.abort();
  await vi.runAllTimersAsync();
  expect(failureOf(await pending)?.type).toBe("cancel");
  expect(h.events.loading.get(LABEL)).toEqual([true, false]);
  expect(h.net.calls("get", REAL)).toBe(0);
});

it("[loading.method.lifecycle × mock.method.lifecycle] 先卸 mock：loading 继续生效；先卸 loading：mock 继续生效；两者都卸载后请求直达真实接口", async () => {
  const h = client();
  h.net.on("get", `${MOCK}${REAL}`, () => envelope("mock"));
  const send = async () => {
    const pending = h.send({ url: REAL, mock: true });
    await vi.runAllTimersAsync();
    return pending;
  };
  expect((await send()).data).toBe("mock");
  expect(h.events.loading.get(LABEL)).toEqual([true, false]);
  expect(h.api.eject("axp:mock")).toBe(true);
  expect((await send()).data).toBe("real");
  expect(h.events.loading.get(LABEL)).toEqual([true, false, true, false]);
  h.api.use(axpMock({ enable: true, mockUrl: MOCK }));
  expect(h.api.eject("axp:loading")).toBe(true);
  expect((await send()).data).toBe("mock");
  expect(h.events.loading.get(LABEL)).toEqual([true, false, true, false]);
  expect(h.api.eject("axp:mock")).toBe(true);
  expect((await send()).data).toBe("real");
  expect(h.api.inspect().filter(/** 排除夹具自身的上下文观测层。 */ (item) => item.name !== UI_OBSERVER)).toEqual([]);
});
