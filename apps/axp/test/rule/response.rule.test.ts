import { AxiosError, type AxiosResponse } from "axios";
import { expect, it } from "vitest";
import { AxpResponse, axpResponse, type IAxpResponse, type IAxpResponseFactory } from "../../src/response";
import { createTestClient } from "../helpers/client";

it.each([false, true])(
  "[core.opt.expectJson] adapter 不返回 headers 时正常响应：expectJson=%s",
  /** 验证自定义 adapter 缺失响应头。 */ async (expectJson) => {
    const { api } = createTestClient(
      [],
      { response: axpResponse({ expectJson }) },
      /** 模拟无响应头的 adapter。 */
      async (config) => ({ config, status: 200, statusText: "", data: "text" }) as AxiosResponse,
    );
    expect(await api.get("/no-headers")(undefined, { wrap: true })).toMatchObject({
      kind: "ok",
      data: "text",
    });
  },
);

/** 模拟独立工厂产出尚未带品牌的普通对象。 */
function plain(response: IAxpResponse): IAxpResponse {
  return { ...response, ok: response.ok, kind: response.kind, status: response.status };
}
it("[core.fn.isAxpResponse][core.opt.response] 自定义完整工厂的普通对象在各入口补品牌", /** 自定义完整工厂的普通对象在各入口补品牌。 */ async () => {
  const base = axpResponse<IAxpResponse>({
    create: /** 自定义构造器直接返回默认响应类。 */ (init) => new AxpResponse(init),
  });
  const factory: IAxpResponseFactory<IAxpResponse> = {
    /** 模拟收到响应的工厂。 */
    fromResponse: (raw, ctx) => plain(base.fromResponse(raw, ctx)),
    /** 模拟传输错误的工厂。 */
    fromError: (error, ctx) => plain(base.fromError(error, ctx)),
    /** 模拟短路与取消的工厂。 */
    fail: (init, ctx) => plain(base.fail(init, ctx)),
  };
  const { api } = createTestClient<IAxpResponse>([], { response: factory });
  expect(api.isResponse(await api.request({ wrap: true }))).toBe(true);
  api.axios.defaults.adapter = /** 模拟离线的传输失败。 */ async () => {
    throw new AxiosError("offline");
  };
  expect(api.isResponse(await api.request({ throws: false }))).toBe(true);
  const controller = new AbortController();
  controller.abort();
  expect(api.isResponse(await api.request({ signal: controller.signal, throws: false }))).toBe(true);
});
