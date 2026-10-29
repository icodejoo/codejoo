import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { expect, it } from "vitest";
import { nativeOf } from "../../src/index";
import type { AxpResponse } from "../../src/response";
import { axpResponse, type IAxpResponse } from "../../src/response";
import axpCache from "../../src/plugins/cache";
import { createTestClient } from "../helpers/client";

/** nativeOf 规则使用的地址。 */
const URL = "/native-of";
/** 成功业务数据。 */
const DATA = "payload";

it("[core.req.raw] nativeOf 读到成功返回副本上的 raw/error/request", async () => {
  const { api, net } = createTestClient();
  net.on("get", URL, /** 返回简单业务数据。 */ () => ({ data: DATA }));
  const result = await api.request<string>({ url: URL, raw: true });
  const native = nativeOf(result);
  expect(native?.raw?.data).toBe(DATA);
  expect(native?.error).toBeUndefined();
  expect(native?.request).toBe(native?.raw?.config);
  expect(nativeOf(await api.request<string>({ url: URL, wrap: true }))).toBeUndefined();
  api.dispose();
});

it.each([false, true])("[core.req.raw][core.req.throws] nativeOf 读到失败副本上的原生数据：throws=%s", async (throws) => {
  const config = { url: URL, headers: new AxiosHeaders() };
  const raw: AxiosResponse = { status: 503, statusText: "", headers: {}, data: DATA, config };
  const error = new AxiosError("offline", undefined, config, undefined, raw);
  const { api } = createTestClient(
    [],
    {},
    /** 模拟带 HTTP 响应的 Axios 异常。 */ async () => {
      throw error;
    },
  );
  const pending = api.request<AxpResponse>({ url: URL, raw: true, throws });
  const result = throws ? await pending.catch(/** 捕获可预期失败。 */ (failure: unknown) => failure) : await pending;
  expect(nativeOf(result)).toEqual({ raw, error, request: config });
  api.dispose();
});

it("[core.req.raw] nativeOf 对非副本一律返回 undefined", () => {
  expect(nativeOf({ ok: true, status: 200, code: 0, data: null })).toBeUndefined();
  expect(nativeOf(new Error("boom"))).toBeUndefined();
  expect(nativeOf(null)).toBeUndefined();
  expect(nativeOf(undefined)).toBeUndefined();
  expect(nativeOf("text")).toBeUndefined();
  expect(nativeOf(1)).toBeUndefined();
});

it("[core.req.raw] 缓存命中的副本 raw 为 undefined 但仍被 nativeOf 识别", async () => {
  const { api, net } = createTestClient([axpCache()]);
  net.on("get", URL, /** 返回简单业务数据。 */ () => ({ data: DATA }));
  await api.request<string>({ url: URL, cache: true });
  const hit = await api.request<string>({ url: URL, cache: true, raw: true });
  expect(net.calls("get", URL)).toBe(1);
  const native = nativeOf(hit);
  expect(native).toBeDefined();
  expect(native?.raw).toBeUndefined();
  expect(native?.error).toBeUndefined();
  expect(native?.request).toBeDefined();
  api.dispose();
});

it("[core.req.raw] 自定义工厂返回可枚举 raw 的响应时，nativeOf 不误判", async () => {
  const factory = axpResponse<IAxpResponse>({
    /** 业务自己的可枚举 raw 字段。 */
    create: (init) => ({ ok: true, status: init.status ?? 200, code: 0, data: init.data, raw: "business" }) as IAxpResponse,
  });
  const { api, net } = createTestClient<IAxpResponse>([], { response: factory });
  net.on("get", URL, /** 返回简单业务数据。 */ () => ({ data: DATA }));
  const result = await api.request<IAxpResponse>({ url: URL, wrap: true });
  expect(Reflect.get(result, "raw")).toBe("business");
  expect(nativeOf(result)).toBeUndefined();
  api.dispose();
});
