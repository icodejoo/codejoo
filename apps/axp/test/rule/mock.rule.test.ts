import { expect, it, vi } from "vitest";
import axpMock, { type IMockOptions } from "../../src/plugins/mock";
import type { AxpResponse } from "../../src/response";
import { envelope, requestRecorder, sourceClient } from "../helpers/source";

/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 另一个 mock 服务器基址。 */
const OTHER_MOCK = "http://other-mock";
/** 被 mock 的接口。 */
const REAL = "/real";
/** 插件名称与阶段。 */
const NAME = "axp:mock";
/** mock 与真实接口的返回值。 */
const MOCK_DATA = "from-mock";
/** 真实接口的返回值。 */
const REAL_DATA = "from-real";

/** 装好 mock 与假网络路由：mock 返回 MOCK_DATA，真实返回 REAL_DATA。 */
function mockClient(options: IMockOptions<AxpResponse> = {}, extra = false) {
  const rec = requestRecorder();
  const h = sourceClient([axpMock({ enable: true, mockUrl: MOCK, ...options }), ...(extra ? [rec.plugin] : [])]);
  h.net.on("get", `${MOCK}${REAL}`, () => envelope(MOCK_DATA));
  h.net.on("get", REAL, () => envelope(REAL_DATA));
  return { ...h, rec };
}

it("[mock.prop.name][mock.opt.enable] 名称为 axp:mock，默认不启用：不进链、不执行，请求直达真实接口", async () => {
  const plugin = axpMock({ mockUrl: MOCK });
  const handle = vi.spyOn(plugin, "handle" as never);
  expect(plugin.name).toBe(NAME);
  expect(plugin.enable).toBe(false);
  const h = sourceClient([plugin]);
  h.net.on("get", REAL, () => envelope(REAL_DATA));
  const r = await h.send({ url: REAL, mock: true });
  expect(r.data).toBe(REAL_DATA);
  expect(handle).not.toHaveBeenCalled();
  expect(h.api.inspect()).toEqual([]);
});

it("[mock.opt.enable] enable:true 进入 source 阶段；请求级开关不能把关闭的插件重新打开", async () => {
  const on = sourceClient([axpMock({ enable: true })]);
  expect(on.api.inspect()).toEqual([{ stage: "source", name: NAME }]);
  const off = sourceClient([axpMock({ enable: false, mockUrl: MOCK })]);
  off.net.on("get", REAL, () => envelope(REAL_DATA));
  const r = await off.send({ url: REAL, mock: { enable: true, mockUrl: MOCK } });
  expect(r.data).toBe(REAL_DATA);
  expect(off.net.calls("get", `${MOCK}${REAL}`)).toBe(0);
});

it("[mock.req.mock][mock.opt.mockUrl] 请求 mock:true 先打 mock，成功直接返回且不触真实接口", async () => {
  const h = mockClient();
  const r = await h.send({ url: REAL, mock: true });
  expect(r.data).toBe(MOCK_DATA);
  expect(r.request.url).toBe(`${MOCK}${REAL}`);
  expect(h.net.calls("get", `${MOCK}${REAL}`)).toBe(1);
  expect(h.net.calls("get", REAL)).toBe(0);
});

it("[mock.fn.axpMock] 没有请求级 mock 且插件级 mock 为 false 时不介入", async () => {
  const h = mockClient();
  const r = await h.send({ url: REAL });
  expect(r.data).toBe(REAL_DATA);
  expect(h.net.calls("get", `${MOCK}${REAL}`)).toBe(0);
});

it("[mock.opt.mock] 插件级 mock:true 让全部请求走 mock；请求级 false 与 enable:false 可退出", async () => {
  const h = mockClient({ mock: true });
  expect((await h.send({ url: REAL })).data).toBe(MOCK_DATA);
  expect((await h.send({ url: REAL, mock: false })).data).toBe(REAL_DATA);
  expect((await h.send({ url: REAL, mock: { enable: false } })).data).toBe(REAL_DATA);
  expect((await h.send({ url: REAL, mock: null as never })).data).toBe(MOCK_DATA);
  expect(h.net.calls("get", `${MOCK}${REAL}`)).toBe(2);
});

it("[mock.cb.fallbackWhen] mock 返回 404 回落真实接口，返回真实数据", async () => {
  const h = mockClient();
  h.net.on("get", `${MOCK}${REAL}`, () => ({ status: 404 }));
  const r = await h.send({ url: REAL, mock: true });
  expect(r.data).toBe(REAL_DATA);
  expect(r.request.url).toBe(REAL);
  expect(h.net.calls("get", `${MOCK}${REAL}`)).toBe(1);
  expect(h.net.calls("get", REAL)).toBe(1);
});

it("[mock.cb.fallbackWhen] mock 不可达（网络错误）回落真实接口", async () => {
  const h = mockClient();
  h.net.on("get", `${MOCK}${REAL}`, () => {
    throw Object.assign(new Error("connect ECONNREFUSED"), {
      isAxiosError: true,
      code: "ERR_NETWORK",
    });
  });
  const r = await h.send({ url: REAL, mock: true });
  expect(r.data).toBe(REAL_DATA);
  expect(h.net.calls("get", REAL)).toBe(1);
});

it.each([403, 500])("[mock.cb.fallbackWhen] mock 返回 %i 说明 mock 存在，原样返回不回落", async (status) => {
  const h = mockClient();
  h.net.on("get", `${MOCK}${REAL}`, () => ({ status }));
  const r = await h.send({ url: REAL, mock: true });
  expect(r.httpStatus).toBe(status);
  expect(h.net.calls("get", REAL)).toBe(0);
});

it("[mock.req.mock.mockUrl] 请求级 mockUrl 覆盖插件级", async () => {
  const h = mockClient();
  h.net.on("get", `${OTHER_MOCK}${REAL}`, () => envelope("from-other"));
  const r = await h.send({ url: REAL, mock: { mockUrl: OTHER_MOCK } });
  expect(r.data).toBe("from-other");
  expect(h.net.calls("get", `${MOCK}${REAL}`)).toBe(0);
});

it("[mock.req.mock.fallbackWhen][mock.cb.fallbackWhen] 请求级判定覆盖插件级，参数是 R", async () => {
  const pluginLevel = vi.fn(() => false);
  const h = mockClient({ fallbackWhen: pluginLevel });
  h.net.on("get", `${MOCK}${REAL}`, () => ({ status: 500 }));
  const requestLevel = vi.fn((r: { httpStatus: number }) => r.httpStatus === 500);
  const r = await h.send({ url: REAL, mock: { fallbackWhen: requestLevel } });
  expect(r.data).toBe(REAL_DATA);
  expect(requestLevel).toHaveBeenCalledOnce();
  expect(requestLevel.mock.calls[0][0]).toMatchObject({ httpStatus: 500, kind: "http" });
  expect(pluginLevel).not.toHaveBeenCalled();
  const fallback = await h.send({ url: REAL, mock: true });
  expect(fallback.httpStatus).toBe(500);
  expect(pluginLevel).toHaveBeenCalledOnce();
});

it("[mock.fn.axpMock] 探测请求关闭 cache 与 share 并改写地址，真实请求保持调用方的开关", async () => {
  const h = mockClient({}, true);
  h.net.on("get", `${MOCK}${REAL}`, () => ({ status: 404 }));
  const options = { cache: true, share: "race", key: "k" } as const;
  await h.send({ url: REAL, mock: true, ...options });
  expect(h.rec.seen).toHaveLength(2);
  expect(h.rec.seen[0]).toMatchObject({
    url: `${MOCK}${REAL}`,
    cache: false,
    share: false,
    key: "k",
  });
  expect(h.rec.seen[1]).toMatchObject({ url: REAL, cache: true, share: "race", key: "k" });
});

it("[mock.method.lifecycle] eject 后不再 mock，请求直达真实接口", async () => {
  const h = mockClient();
  expect((await h.send({ url: REAL, mock: true })).data).toBe(MOCK_DATA);
  expect(h.api.eject(NAME)).toBe(true);
  expect((await h.send({ url: REAL, mock: true })).data).toBe(REAL_DATA);
  expect(h.api.inspect()).toEqual([]);
});
