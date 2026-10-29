import { nativeFields } from "../helpers/native";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { assert, expect, it, vi } from "vitest";
import type { AxpContext } from "../../src/context";
import { axpResponse, type AxpResponse, type IAxpResponse } from "../../src/response";
import { createTestClient } from "../helpers/client";

/** 原生数据规则使用的地址。 */
const URL = "/native-rule";
/** 业务数据。 */
const DATA = "payload";
/** 空槽的原生数据快照。 */
const EMPTY_NATIVE = { response: undefined, error: undefined };
/** JSON 中不应出现的原生响应字段。 */
const RAW_JSON_KEY = '"raw"';
/** JSON 中不应出现的原始异常字段。 */
const ERROR_JSON_KEY = '"error"';

it.each([undefined, false, true])("[core.req.raw] 仅请求级 true 开启原生副本并覆盖 wrap:false：%s", async (raw) => {
  let ctx!: AxpContext;
  let original!: AxpResponse;
  let native!: AxiosResponse;
  const { api, net } = createTestClient([
    {
      name: "native-observer",
      /** 捕获工厂结果，验证开关关闭时保持身份。 */
      async handle(current, next) {
        ctx = current;
        original = await next({ headers: { "x-native": DATA } });
        const snapshot = current.native.response;
        assert(snapshot);
        native = snapshot;
        expect(current.nativeFor(original)?.response).toBe(native);
        return original;
      },
    },
  ]);
  net.on("get", URL, /** 返回简单业务数据。 */ () => ({ data: DATA }));
  Object.assign(api.axios.defaults, { raw: true });
  const result = await api.request<AxpResponse | string>({ url: URL, raw, wrap: false });
  if (raw) {
    assert(api.isResponse(result));
    const response = result;
    expect(response).not.toBe(original);
    expect(nativeFields(response).raw).toBe(native);
    expect(response.request).toBe(native.config);
    expect(response.data).toBe(DATA);
    expect(nativeFields(response).error).toBeUndefined();
    for (const key of ["raw", "error", "request"]) {
      expect(Object.getOwnPropertyDescriptor(response, key)?.enumerable).toBe(false);
      expect(Object.keys(response)).not.toContain(key);
    }
    expect(JSON.stringify(response)).not.toContain(RAW_JSON_KEY);
    expect(JSON.stringify(response)).not.toContain(ERROR_JSON_KEY);
    expect(JSON.stringify(response)).not.toContain("x-native");
  } else expect(result).toBe(DATA);
  expect(ctx.native).toEqual(EMPTY_NATIVE);
  api.dispose();
});

it("[core.req.raw] 关闭时 wrap 保留工厂原对象，axios.defaults.raw 不启用开关", async () => {
  let original!: AxpResponse;
  const { api } = createTestClient([
    {
      name: "identity-observer",
      /** 记录未落定对象。 */
      async handle(_ctx, next) {
        original = await next();
        return original;
      },
    },
  ]);
  Object.assign(api.axios.defaults, { raw: true });
  expect(await api.request({ url: URL, wrap: true })).toBe(original);
  expect(await api.request({ url: URL, raw: false, wrap: true })).toBe(original);
  api.dispose();
});

it.each([false, true])("[core.req.raw][core.req.throws] 传输失败原生数据附到返回或抛出的副本：throws=%s", async (throws) => {
  const config = { url: URL, headers: new AxiosHeaders() };
  const raw: AxiosResponse = { status: 503, statusText: "", headers: {}, data: DATA, config };
  const error = new AxiosError("offline", undefined, config, undefined, raw);
  let original!: AxpResponse;
  let ctx!: AxpContext;
  const factory = axpResponse();
  const fail = vi.fn(factory.fail.bind(factory));
  const { api } = createTestClient(
    [
      {
        name: "failure-observer",
        /** 保存原始响应及上下文。 */
        async handle(current, next) {
          ctx = current;
          original = await next();
          return original;
        },
      },
    ],
    { response: { ...factory, fail }, debug: true },
    /** 模拟带 HTTP 响应的 Axios 异常。 */ async () => {
      throw error;
    },
  );
  const pending = api.request<AxpResponse>({ url: URL, raw: true, throws });
  const result = throws ? await pending.catch(/** 捕获可预期失败。 */ (failure: AxpResponse) => failure) : await pending;
  expect(result).not.toBe(original);
  expect(nativeFields(result).raw).toBe(raw);
  expect(nativeFields(result).error).toBe(error);
  expect(result.request).toBe(config);
  expect(result.ok).toBe(false);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(fail.mock.calls[0][0]).not.toHaveProperty("raw");
  expect(fail.mock.calls[0][0]).not.toHaveProperty("error");
  expect(fail.mock.calls[0][0]).not.toHaveProperty("request");
  if (throws) expect(result.stack).toEqual(expect.any(String));
  else expect(result.stack).toBeUndefined();
  expect(ctx.native).toEqual(EMPTY_NATIVE);
  expect(JSON.stringify(result)).not.toContain(RAW_JSON_KEY);
  expect(JSON.stringify(result)).not.toContain(ERROR_JSON_KEY);
  api.dispose();
});

it.each([false, true])("[core.req.raw] 内层补丁不改变原始请求的 raw 开关：%s", async (raw) => {
  const { api } = createTestClient([
    {
      name: "raw-patch",
      /** 让合并视图与原始请求开关相反。 */
      async handle(_ctx, next) {
        return next({ raw: !raw });
      },
    },
  ]);
  const result = await api.request<AxpResponse | null>({ url: URL, raw });
  if (raw) {
    assert(api.isResponse(result));
    expect(nativeFields(result).raw).toBeDefined();
  } else expect(result).toBeNull();
  api.dispose();
});

it("[core.req.raw] 普通接口响应的原生字段在工厂完成后覆盖，JSON 不含三个字段", async () => {
  const factory = axpResponse<IAxpResponse>({
    /** 接口实现不含类方法，验证工厂补齐字段与落定附加原生字段。 */
    create: (init) => ({ ok: true, status: init.status ?? 200, code: 0, data: init.data ?? DATA }),
  });
  const { api } = createTestClient<IAxpResponse>([], { response: factory });
  const result = await api.request<IAxpResponse>({ url: URL, raw: true });
  expect(nativeFields(result).raw).toBeDefined();
  expect(Reflect.get(result, "request")).toBe(nativeFields(result).raw!.config);
  expect(Object.keys(result)).toEqual(["ok", "status", "code", "data"]);
  const json: unknown = JSON.parse(JSON.stringify(result));
  expect(json).not.toHaveProperty("raw");
  expect(json).not.toHaveProperty("error");
  expect(json).not.toHaveProperty("request");
  api.dispose();
});
