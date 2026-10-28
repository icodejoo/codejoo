import { readFileSync } from "node:fs";
import { expect, expectTypeOf, it } from "vitest";
import { createAxp } from "../../src/client";
import { stateKey } from "../../src/context";
import { AxpResponse, isAxpResponse, type IAxpResponse } from "../../src/response";
import type { IRetryOptions } from "../../src/plugins/retry";
import type { AxpOption } from "../../src/options";
import type { AxpPlugin, AxpRequestOptions, WithData } from "../../src/types";
import { customResponse, TestResponse } from "../helpers/client";

declare module "../../src/types" {
  interface AxpRequestOptions {
    /** 类型测试模拟缓存插件的请求扩展。 */
    cache?: boolean;
  }
}
/** 方法优先 Schema；接口无需索引签名。 */
interface ISchema {
  /** GET 路径表。 */
  get: {
    /** 必填参数接口。 */
    "/pet": readonly [{ /** 名称。 */ name: string }, readonly [{ /** 主键。 */ id: number }]];
    /** 无 payload 接口。 */
    "/empty": readonly [number, readonly []];
  };
  /** POST 路径表。 */
  post: {
    /** 创建接口。 */ "/pet": readonly [boolean, readonly [string]];
  };
}
/** 假泛型插件验证工厂调用时的上下文推断。 */
function axpGeneric<R extends IAxpResponse = IAxpResponse>(options: {
  /** 判定回调。 */ check: (r: R) => boolean;
}): AxpPlugin<R> {
  return {
    name: "generic",
    /** 取内层响应交给调用方提供的类型检查。 */ async handle(_ctx, next) {
      const response = await next();
      options.check(response);
      return response;
    },
  };
}

it("[core.fn.createAxp][core.req.wrap][core.req.throws] Schema/响应泛型/插件推断与模块扩展编译契约", /** Schema/响应泛型/插件推断与模块扩展编译契约。 */ () => {
  /** 只编译调用示例，避免发送真实网络请求。 */
  function contracts() {
    const api = createAxp<ISchema, TestResponse>({
      response: customResponse(),
      plugins: [
        axpGeneric({
          check: /** 断言响应类型并返回判定结果。 */ (response) => {
            expectTypeOf(response).toEqualTypeOf<TestResponse>();
            return response.traceId !== "";
          },
        }),
      ],
    });
    const standalone = axpGeneric<TestResponse>({
      check: /** 仅判定追踪标识非空。 */ (response) => response.traceId !== "",
    });
    api.use(standalone);
    expectTypeOf(api.get("/pet")({ id: 1 })).toEqualTypeOf<
      Promise<{ /** name 字段。 */ name: string }>
    >();
    expectTypeOf(api.get("/empty")()).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.post("/pet")("body")).toEqualTypeOf<Promise<boolean>>();
    expectTypeOf(api.get("/pet")({ id: 1 }, { wrap: true })).toEqualTypeOf<
      Promise<WithData<TestResponse, { /** name 字段。 */ name: string }>>
    >();
    expectTypeOf(api.get("/pet")({ id: 1 }, { throws: false })).toEqualTypeOf<
      Promise<WithData<TestResponse, { /** name 字段。 */ name: string }>>
    >();
    expectTypeOf(api.get("/empty", { wrap: true })()).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
    expectTypeOf(api.request<number>({ url: "/escape" })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.request<number>({ wrap: true })).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
    expectTypeOf(api.request<number>({ throws: false })).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
    api.get("/pet")({ id: 1 }, { retry: 2, cache: true });
    // @ts-expect-error 扩展字段仍校验值类型。
    api.get("/pet")({ id: 1 }, { retry: "twice" });
    // @ts-expect-error Schema 不存在的路径。
    api.get("/missing");
    // @ts-expect-error 缺少必填 payload。
    api.get("/pet")();
    // @ts-expect-error NoInfer 阻止错误 payload 被反推为合法。
    api.get("/pet")({ id: "wrong" });
    // @ts-expect-error 方法对应的路径表不能串用。
    api.post("/empty");
    // @ts-expect-error 自定义响应必须提供 response。
    createAxp<ISchema, TestResponse>();
    // @ts-expect-error 客户端不再支持 throws 默认值。
    createAxp<ISchema, TestResponse>({ response: customResponse(), throws: false });
    const wrongFactory = {
      /** 缺少扩展字段的响应。 */
      fromResponse: () => new AxpResponse(),
      /** 缺少扩展字段的异常响应。 */
      fromError: () => new AxpResponse(),
      /** 缺少扩展字段的合成响应。 */
      fail: () => new AxpResponse(),
    };
    // @ts-expect-error response 产出必须含 traceId。
    createAxp<ISchema, TestResponse>({ response: wrongFactory });
    const error: unknown = {};
    if (api.isResponse(error)) expectTypeOf(error).toEqualTypeOf<TestResponse>();
    if (isAxpResponse<TestResponse>(error)) expectTypeOf(error).toEqualTypeOf<TestResponse>();
    const numeric = stateKey<number>("numeric");
    const textual = stateKey<string>("textual");
    expectTypeOf(numeric).not.toEqualTypeOf(textual);
    expectTypeOf<TestResponse>().toExtend<IAxpResponse>();
    expectTypeOf<AxpRequestOptions>().toExtend<{
      /** retry 字段。 */ retry?: AxpOption<IRetryOptions<any>, number>;
      /** cache 字段。 */ cache?: boolean;
    }>();
    const generated = createAxp<model.MethodRefs>();
    expectTypeOf(generated.get("/pet/{petId}")({ petId: 1 })).toEqualTypeOf<Promise<model.Pet>>();
    const local = createAxp<model.LocalMethodRefs>();
    expectTypeOf(local.post("/pet/draft")({ name: "draft", photoUrls: [] })).toEqualTypeOf<
      Promise<model.Pet>
    >();
    expectTypeOf(local.get("/experimental/whatever")()).toEqualTypeOf<Promise<unknown>>();
    // @ts-expect-error 旧 raw 返回形态已经删除。
    api.get("/empty")(undefined, { raw: true });
    // @ts-expect-error nullable 不再是新请求选项。
    api.get("/empty")(undefined, { nullable: true });
    // @ts-expect-error key 不接受旧 true/数字/函数形式。
    api.get("/empty")(undefined, { key: true });
    // @ts-expect-error 新内核不支持 cancelToken。
    api.request({ cancelToken: {} });
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.req.wrap] 分派类型按调用级覆盖方法级：有无选项四组合", /** 验证显式数据泛型与包装覆盖。 */ () => {
  /** 仅编译类型调用。 */
  function contracts() {
    const api = createAxp<unknown, TestResponse>({ response: customResponse() });
    expectTypeOf(api.get("/x")<number>()).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x")<number>(undefined, { wrap: true })).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
    expectTypeOf(api.get("/x", { wrap: true })<number>()).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, { wrap: false })).toEqualTypeOf<
      Promise<number>
    >();
    expectTypeOf(api.get("/x", { wrap: false })<number>(undefined, { wrap: true })).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
    expectTypeOf(
      api.get("/x", { wrap: true })<number>(undefined, { wrap: undefined }),
    ).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(
      api.get("/x", { throws: false })<number>(undefined, { wrap: false }),
    ).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(
      api.get("/x", { wrap: true, throws: false })<number>(undefined, {
        wrap: false,
        throws: true,
      }),
    ).toEqualTypeOf<Promise<number>>();
  }
  expect(contracts).toBeTypeOf("function");
});
it("[core.req.throws] 分派类型按调用级覆盖方法级：有无选项四组合", /** 验证显式数据泛型与抛错覆盖。 */ () => {
  /** 仅编译类型调用。 */
  function contracts() {
    const api = createAxp<unknown, TestResponse>({ response: customResponse() });
    expectTypeOf(api.get("/x")<number>()).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x")<number>(undefined, { throws: false })).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
    expectTypeOf(api.get("/x", { throws: false })<number>()).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
    expectTypeOf(
      api.get("/x", { throws: false })<number>(undefined, { throws: true }),
    ).toEqualTypeOf<Promise<number>>();
    expectTypeOf(
      api.get("/x", { throws: true })<number>(undefined, { throws: false }),
    ).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(
      api.get("/x", { throws: false })<number>(undefined, { throws: undefined }),
    ).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, { throws: true })).toEqualTypeOf<
      Promise<WithData<TestResponse, number>>
    >();
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.fn.createAxp] 本地 Schema 扩展夹具与现有模板完全一致", /** 本地 Schema 扩展夹具与现有模板完全一致。 */ () => {
  const template = readFileSync(
    new URL("../../types/local/example.d.ts.template", import.meta.url),
    "utf8",
  );
  const fixture = readFileSync(new URL("../helpers/local-schema.d.ts", import.meta.url), "utf8");
  expect(fixture).toBe(template);
});
