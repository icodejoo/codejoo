import { expect, it, vi } from "vitest";
import axpMock, { type IMockOptions } from "../../src/plugins/mock";
import type { AxpResponse } from "../../src/response";
import type { AxpLogger } from "../../src/types";
import { envelope, sourceClient } from "../helpers/source";

/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 被 mock 的接口。 */
const REAL = "/real";
/** 真实接口返回值。 */
const REAL_DATA = "from-real";
/** mock 返回值。 */
const MOCK_DATA = "from-mock";
/** 探测地址。 */
const PROBE = `${MOCK}${REAL}`;

/** 可观测的调试日志。 */
function logger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
/** 装好 mock 与两条路由的客户端。 */
function mockClient(options: IMockOptions<AxpResponse> = {}, debug?: AxpLogger) {
  const h = sourceClient([axpMock<AxpResponse>({ enable: true, mockUrl: MOCK, ...options })], debug ? { debug } : {});
  h.net.on("get", PROBE, () => envelope(MOCK_DATA));
  h.net.on("get", REAL, () => envelope(REAL_DATA));
  return h;
}

it.each([
  ["插件与请求都没有 mockUrl", { mockUrl: undefined }, true],
  ["空串 mockUrl 视为未配置", { mockUrl: "" }, true],
  ["请求级空串不回退到插件级", {}, { mockUrl: "" }],
])("[mock.opt.mockUrl][mock.req.mock.mockUrl] %s：跳过 mock 直接请求真实接口，debug 下 warn", async (_label, options, mock) => {
  const debug = logger();
  const h = mockClient(options, debug);
  const r = await h.send({ url: REAL, mock });
  expect(r.data).toBe(REAL_DATA);
  expect(h.net.calls("get", PROBE)).toBe(0);
  expect(debug.warn).toHaveBeenCalledOnce();
  expect(debug.warn.mock.calls[0]![0]).toContain("mockUrl");
});

it("[mock.opt.mockUrl] 没开 debug 时跳过 mock 不输出任何日志", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const h = mockClient({ mockUrl: undefined });
  expect((await h.send({ url: REAL, mock: true })).data).toBe(REAL_DATA);
  expect(warn).not.toHaveBeenCalled();
});

it.each([`${MOCK}/`, `${MOCK}///`])("[mock.opt.mockUrl] 基址 %s 结尾斜杠不产生双斜杠，绝对地址去掉原 origin 保留 query", async (base) => {
  const h = mockClient({ mockUrl: base });
  h.net.on("get", `${MOCK}/pet?id=1`, () => envelope(MOCK_DATA));
  const r = await h.send({ url: "http://real.example/pet?id=1", mock: true });
  expect(r.data).toBe(MOCK_DATA);
  expect(r.request.url).toBe(`${MOCK}/pet?id=1`);
});

it("[mock.opt.mockUrl] 请求没有 url 时探测改写 baseURL", async () => {
  const seen: { baseURL?: string; url?: string }[] = [];
  const h = sourceClient([axpMock<AxpResponse>({ enable: true, mockUrl: MOCK })], {}, async (config) => {
    seen.push({ baseURL: config.baseURL, url: config.url });
    return { status: 200, statusText: "", headers: {}, config, data: { code: 0, data: 1 } };
  });
  await h.send({ url: undefined, mock: true });
  expect(seen).toEqual([{ baseURL: MOCK, url: undefined }]);
});

it("[mock.cb.fallbackWhen] 判定抛错按程序 bug 抛原始异常，不发送真实回落，后续请求不受影响", async () => {
  const bug = new Error("fallback bug");
  const h = mockClient({
    fallbackWhen: () => {
      throw bug;
    },
  });
  await expect(h.send({ url: REAL, mock: true })).rejects.toBe(bug);
  expect(h.net.calls("get", REAL)).toBe(0);
  expect((await h.send({ url: REAL, mock: false })).data).toBe(REAL_DATA);
});

it.each([
  [1, true],
  ["yes", true],
  [0, false],
  ["", false],
])("[mock.cb.fallbackWhen] 判定返回 %j 按真值决定是否回落", async (verdict, falls) => {
  const h = mockClient({ fallbackWhen: () => verdict as never });
  const r = await h.send({ url: REAL, mock: true });
  expect(r.data).toBe(falls ? REAL_DATA : MOCK_DATA);
  expect(h.net.calls("get", REAL)).toBe(falls ? 1 : 0);
});

it("[mock.cb.fallbackWhen] 探测期间取消：默认不回落，也不发送真实请求", async () => {
  const controller = new AbortController();
  const h = mockClient();
  h.net.on("get", PROBE, () => envelope(MOCK_DATA));
  const pending = h.send({
    url: REAL,
    mock: true,
    signal: controller.signal,
    latency: 20,
  } as never);
  controller.abort();
  const r = await pending;
  expect(r.kind).toBe("cancel");
  expect(h.net.calls("get", REAL)).toBe(0);
});

it("[mock.cb.fallbackWhen] 回落前调用方已取消：即使判定要求回落，真实请求也不触网", async () => {
  const controller = new AbortController();
  const h = mockClient({
    fallbackWhen: () => {
      controller.abort();
      return true;
    },
  });
  const r = await h.send({ url: REAL, mock: true, signal: controller.signal });
  expect(r.kind).toBe("cancel");
  expect(h.net.calls("get", REAL)).toBe(0);
});

it("[mock.fn.axpMock] 回落后真实接口失败：保留真实结果，只落定一次且不再回落", async () => {
  const h = mockClient();
  h.net.on("get", PROBE, () => ({ status: 404 }));
  h.net.on("get", REAL, () => ({ status: 500 }));
  const r = await h.send({ url: REAL, mock: true });
  expect(r.httpStatus).toBe(500);
  expect(h.net.calls("get", PROBE)).toBe(1);
  expect(h.net.calls("get", REAL)).toBe(1);
});

it.each([0, "yes", Number.NaN, -1, () => true])("[mock.req.mock] 未声明的请求值 %s 按省略处理，由插件级 mock 决定", async (value) => {
  const on = mockClient({ mock: true });
  expect((await on.send({ url: REAL, mock: value as never })).data).toBe(MOCK_DATA);
  const off = mockClient({ mock: false });
  expect((await off.send({ url: REAL, mock: value as never })).data).toBe(REAL_DATA);
});

it("[mock.req.mock] 空对象表示请求开启：有插件级 mockUrl 即 mock，没有则跳过；对象里的 mock 字段不再生效", async () => {
  const h = mockClient();
  expect((await h.send({ url: REAL, mock: {} })).data).toBe(MOCK_DATA);
  expect((await h.send({ url: REAL, mock: { mock: false } as never })).data).toBe(MOCK_DATA);
  const bare = mockClient({ mockUrl: undefined });
  expect((await bare.send({ url: REAL, mock: {} })).data).toBe(REAL_DATA);
});

it("[mock.cb.fallbackWhen] 回落时在 debug 下输出一条日志", async () => {
  const debug = logger();
  const h = mockClient({}, debug);
  h.net.on("get", PROBE, () => ({ status: 404 }));
  await h.send({ url: REAL, mock: true });
  expect(debug.log).toHaveBeenCalledOnce();
  expect(debug.log.mock.calls[0]![0]).toContain("404");
});

it("[mock.method.lifecycle] eject 重复调用安全，卸载后可用同一个插件对象重装并恢复 mock", async () => {
  const plugin = axpMock<AxpResponse>({ enable: true, mockUrl: MOCK });
  const h = sourceClient([plugin]);
  h.net.on("get", PROBE, () => envelope(MOCK_DATA));
  h.net.on("get", REAL, () => envelope(REAL_DATA));
  expect(h.api.eject("axp:mock")).toBe(true);
  expect(h.api.eject("axp:mock")).toBe(false);
  expect((await h.send({ url: REAL, mock: true })).data).toBe(REAL_DATA);
  h.api.use(plugin);
  expect((await h.send({ url: REAL, mock: true })).data).toBe(MOCK_DATA);
});

it("[mock.opt.fallbackWhen] 探测后回落真实接口，两次发送的请求体相互独立，原地修改的 transformRequest 不会叠加", async () => {
  const sent: unknown[] = [];
  const h = sourceClient(
    [axpMock<AxpResponse>({ enable: true, mockUrl: MOCK })],
    {},
    {
      transformRequest: [
        /** 原地修改嵌套元素后再序列化，模拟不规范的用户转换器。 */ (data: { qty: number }[]) => {
          data[0]!.qty += 1;
          return JSON.stringify(data);
        },
      ],
    },
  );
  h.net.on("post", PROBE, (config) => {
    sent.push(config.data);
    return { status: 404, data: {} };
  });
  h.net.on("post", REAL, (config) => {
    sent.push(config.data);
    return envelope(REAL_DATA);
  });
  await h.send({ url: REAL, method: "post", data: [{ qty: 1 }], mock: true });
  expect(sent).toEqual([JSON.stringify([{ qty: 2 }]), JSON.stringify([{ qty: 2 }])]);
});
