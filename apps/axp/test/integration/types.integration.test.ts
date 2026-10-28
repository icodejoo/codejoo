import { readFileSync } from "node:fs";
import { expect, expectTypeOf, it } from "vitest";
import { createAxp } from "../../src/client";
import { stateKey, type AxpContext } from "../../src/context";
import type { ITokenManager } from "../../src/objects/TokenManager";
import axpAuth from "../../src/plugins/auth";
import axpCache, { type ICacheRequestOptions } from "../../src/plugins/cache";
import axpRetry, { type IRetryOptions } from "../../src/plugins/retry";
import type { AxpOption } from "../../src/options";
import { AxpResponse, axpResponse, isAxpResponse, type AxpKind, type IAxpResponse, type IAxpResponseFactory } from "../../src/response";
import type { AxpPlugin, AxpRequestOptions, WithData } from "../../src/types";
import { customResponse, TestResponse } from "../helpers/client";

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
/** 覆盖 ok、status getter 的响应子类：成功码是 200，令牌过期码按 401 处理。 */
class CodeResponse<D = unknown> extends AxpResponse<D> {
  /** 业务成功码是 200。 */
  get ok(): boolean {
    return this.httpStatus < 300 && this.code === 200;
  }
  /** 令牌过期码映射为 401，其余沿用默认规则。 */
  get status(): number {
    return this.code === "TOKEN_EXPIRED" ? 401 : super.status;
  }
}
/** 假泛型插件验证工厂调用时的上下文推断。 */
function axpGeneric<R extends IAxpResponse = IAxpResponse>(options: { /** 判定回调。 */ check: (r: R) => boolean }): AxpPlugin<R> {
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
    expectTypeOf(api.get("/pet")({ id: 1 })).toEqualTypeOf<Promise<{ /** name 字段。 */ name: string }>>();
    expectTypeOf(api.get("/empty")()).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.post("/pet")("body")).toEqualTypeOf<Promise<boolean>>();
    expectTypeOf(api.get("/pet")({ id: 1 }, { wrap: true })).toEqualTypeOf<Promise<WithData<TestResponse, { /** name 字段。 */ name: string }>>>();
    expectTypeOf(api.get("/pet")({ id: 1 }, { throws: false })).toEqualTypeOf<Promise<WithData<TestResponse, { /** name 字段。 */ name: string }>>>();
    expectTypeOf(api.get("/empty", { wrap: true })()).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.request<number>({ url: "/escape" })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.request<number>({ wrap: true })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.request<number>({ throws: false })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    void api.get("/pet")({ id: 1 }, { retry: 2, cache: true });
    // @ts-expect-error 扩展字段仍校验值类型。
    void api.get("/pet")({ id: 1 }, { retry: "twice" });
    // @ts-expect-error Schema 不存在的路径。
    api.get("/missing");
    // @ts-expect-error 缺少必填 payload。
    void api.get("/pet")();
    // @ts-expect-error NoInfer 阻止错误 payload 被反推为合法。
    void api.get("/pet")({ id: "wrong" });
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
      /** cache 字段。 */ cache?: AxpOption<ICacheRequestOptions, number>;
    }>();
    const generated = createAxp<model.MethodRefs>();
    expectTypeOf(generated.get("/pet/{petId}")({ petId: 1 })).toEqualTypeOf<Promise<model.Pet>>();
    const local = createAxp<model.LocalMethodRefs>();
    expectTypeOf(local.post("/pet/draft")({ name: "draft", photoUrls: [] })).toEqualTypeOf<Promise<model.Pet>>();
    expectTypeOf(local.get("/experimental/whatever")()).toEqualTypeOf<Promise<unknown>>();
    // @ts-expect-error 旧 raw 返回形态已经删除。
    void api.get("/empty")(undefined, { raw: true });
    // @ts-expect-error nullable 不再是新请求选项。
    void api.get("/empty")(undefined, { nullable: true });
    // key: true 保留为"自动计算"，兼容旧写法。
    void api.get("/empty")(undefined, { key: true });
    // @ts-expect-error key 不接受旧数字形式。
    void api.get("/empty")(undefined, { key: 1 });
    // @ts-expect-error key 不接受旧函数形式。
    void api.get("/empty")(undefined, { key: () => "k" });
    // @ts-expect-error 新内核不支持 cancelToken。
    void api.request({ cancelToken: {} });
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.req.wrap] 分派类型按调用级覆盖方法级：有无选项四组合", /** 验证显式数据泛型与包装覆盖。 */ () => {
  /** 仅编译类型调用。 */
  function contracts() {
    const api = createAxp<unknown, TestResponse>({ response: customResponse() });
    expectTypeOf(api.get("/x")<number>()).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x")<number>(undefined, { wrap: true })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>()).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, { wrap: false })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x", { wrap: false })<number>(undefined, { wrap: true })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, { wrap: undefined })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>(undefined, { wrap: false })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
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
    expectTypeOf(api.get("/x")<number>(undefined, { throws: false })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>()).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>(undefined, { throws: true })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x", { throws: true })<number>(undefined, { throws: false })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>(undefined, { throws: undefined })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, { throws: true })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.fn.createAxp] 本地 Schema 扩展夹具与现有模板完全一致", /** 本地 Schema 扩展夹具与现有模板完全一致。 */ () => {
  const template = readFileSync(new URL("../../types/local/example.d.ts.template", import.meta.url), "utf8");
  const fixture = readFileSync(new URL("../helpers/local-schema.d.ts", import.meta.url), "utf8");
  expect(fixture).toBe(template);
});

it("[retry.cb.shouldRetry][retry.opt.delay][auth.cb.onRefresh][auth.cb.onFailure][cache.cb.shouldCache] 内置插件的判定回调内联在 createAxp<S, MyResponse> 里时推断为 MyResponse，单独定义时手写泛型", /** 编译期契约：R 沿 plugins 数组的上下文流入每个回调。 */ () => {
  /** 只编译调用示例，避免发送真实网络请求。 */
  function contracts() {
    const tokens = {} as ITokenManager;
    const api = createAxp<ISchema, TestResponse>({
      response: customResponse(),
      plugins: [
        axpRetry({
          shouldRetry: /** 判定回调的第一个参数是自定义响应。 */ (r, attempt, ctx) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(attempt).toEqualTypeOf<number>();
            expectTypeOf(ctx).toEqualTypeOf<AxpContext<TestResponse>>();
            return r.traceId === "";
          },
          delay: /** 延迟函数的第三个参数同样是自定义响应。 */ (attempt, max, r) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            return r.traceId ? attempt : max;
          },
        }),
        axpAuth({
          tokenManager: tokens,
          onRefresh: /** 刷新回调收到自定义响应与会话管理器。 */ (r, tm) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(tm).toEqualTypeOf<ITokenManager>();
            return r.traceId;
          },
          onAccessExpired: /** 过期通知收到自定义响应。 */ (r) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
          },
          onAccessDenied: /** 拒绝通知收到自定义响应。 */ (r) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
          },
          onFailure: /** 路由回调收到自定义响应与上下文。 */ (r, _tm, ctx) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(ctx).toEqualTypeOf<AxpContext<TestResponse>>();
            return r.traceId ? "refresh" : undefined;
          },
        }),
        axpCache({
          shouldCache: /** 写入判定收到自定义响应。 */ (r) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            return r.traceId !== "";
          },
        }),
      ],
    });
    // 单独定义成变量时手写泛型，回调参数就是自定义响应。
    const retry = axpRetry<TestResponse>({
      shouldRetry: /** 手写泛型后的判定回调。 */ (r) => r.traceId !== "",
    });
    expectTypeOf(retry).toEqualTypeOf<AxpPlugin<TestResponse>>();
    api.use(retry);
    // 单独定义却不写泛型：R 退回默认响应，装进自定义响应的客户端会报错。
    const bare = axpRetry({
      shouldRetry: /** 没有上下文可推断，参数是默认响应。 */ (r) => {
        expectTypeOf(r).toEqualTypeOf<AxpResponse>();
        return false;
      },
    });
    // @ts-expect-error 单独定义的插件必须手写泛型。
    api.use(bare);
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.fn.createAxp][core.opt.plugins][core.opt.reject] 不写泛型时 R 只由 response 工厂决定：内联与单独定义的插件都按默认响应装配", /** 编译期契约：plugins 与 reject 不参与推断 R。 */ () => {
  /** 只编译调用示例，避免发送真实网络请求。 */
  function contracts() {
    const inline = createAxp({ plugins: [axpRetry(), axpCache()] });
    expectTypeOf<typeof inline.isResponse>().guards.toEqualTypeOf<AxpResponse>();
    // README 的写法：插件先单独定义，再装进默认客户端。
    const cache = axpCache();
    expectTypeOf(cache).toExtend<AxpPlugin<AxpResponse, any>>();
    createAxp({ plugins: [cache], reject: /** 默认响应。 */ (r) => expectTypeOf(r).toEqualTypeOf<AxpResponse>() });
    // 只给 response 工厂时，R 从工厂推断；自定义 R 的插件回调要靠显式泛型 createAxp<S, MyResponse> 收窄。
    const custom = createAxp({ response: customResponse() });
    expectTypeOf<typeof custom.isResponse>().guards.toEqualTypeOf<TestResponse>();
    // @ts-expect-error 默认响应的插件不能装进自定义响应的客户端。
    createAxp({ response: customResponse(), plugins: [cache] });
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.fn.axpResponse][core.prop.ok][core.prop.status] 子类覆盖 ok / status getter 后仍满足 IAxpResponse，工厂与客户端按子类推断", /** 编译期契约：判定的开放点是 getter 本身。 */ () => {
  /** 只编译类型调用。 */
  function contracts() {
    expectTypeOf<CodeResponse>().toExtend<IAxpResponse>();
    expectTypeOf<CodeResponse["ok"]>().toEqualTypeOf<boolean>();
    expectTypeOf<CodeResponse["status"]>().toEqualTypeOf<number>();
    expectTypeOf<CodeResponse["kind"]>().toEqualTypeOf<AxpKind>();
    expectTypeOf<CodeResponse<string>["data"]>().toEqualTypeOf<string>();
    const factory = axpResponse<CodeResponse>({
      create: /** 由初始化字段构造子类。 */ (init) => new CodeResponse(init),
    });
    expectTypeOf(factory).toEqualTypeOf<IAxpResponseFactory<CodeResponse>>();
    const api = createAxp<ISchema, CodeResponse>({ response: factory });
    expectTypeOf(api.get("/empty", { wrap: true })()).toEqualTypeOf<Promise<WithData<CodeResponse, number>>>();
    const error: unknown = {};
    if (api.isResponse(error)) expectTypeOf(error).toEqualTypeOf<CodeResponse>();
    // 不满足契约的形状不是响应。
    expectTypeOf<{ /** 仅有 ok。 */ readonly ok: boolean }>().not.toExtend<IAxpResponse>();
    class BadResponse extends AxpResponse {
      /** 把成功判定写成字符串，违反契约。 */
      // @ts-expect-error getter 的类型必须与契约一致。
      get ok(): string {
        return "yes";
      }
    }
    void BadResponse;
  }
  expect(contracts).toBeTypeOf("function");
});
