import { readFileSync } from "node:fs";
import { create as createAxios, type AxiosResponse } from "axios";
import type { IAxpCacheStore, ICacheApi, MaybePromise } from "../../src/index";
import { asyncCacheStore } from "../helpers/source";
import { expect, expectTypeOf, it } from "vitest";
import { createAxp } from "../../src/client";
import { stateKey, type AxpContext } from "../../src/context";
import type { ITokenManager } from "../../src/objects/TokenManager";
import axpAuth from "../../src/plugins/auth";
import axpCache, { type ICacheRequestOptions } from "../../src/plugins/cache";
import axpMock from "../../src/plugins/mock";
import axpRetry, { type IRetryOptions } from "../../src/plugins/retry";
import type { AxpOption } from "../../src/index";
import { AxpResponse, axpResponse, isAxpResponse, type IAxpResponse, type IAxpResponseFactory } from "../../src/response";
import type { AxpClient, AxpPlugin, AxpRequestConfig, AxpRequestOptions, AxpResult, WithData, WithNative } from "../../src/types";
import { customResponse, TestResponse } from "../helpers/client";

it("[core.method.extend][cache.type.options] 指定 axios、异步仓与管理 API 的类型契约", () => {
  const api = createAxp<unknown, TestResponse>({ response: customResponse() });
  const axios = createAxios();
  const child = api.extend({ timeout: 1 }, { axios });
  expectTypeOf(child).toEqualTypeOf<typeof api>();
  const { store } = asyncCacheStore();
  expectTypeOf(store).toEqualTypeOf<IAxpCacheStore>();
  expectTypeOf<ICacheApi["remove"]>().returns.toEqualTypeOf<MaybePromise<boolean>>();
  expectTypeOf<ICacheApi["clear"]>().returns.toEqualTypeOf<MaybePromise<number>>();
  expect(child.axios).toBe(axios);
  child.dispose();
  api.dispose();
});

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
/** 覆盖 ok getter 的响应子类，保留 HTTP 状态，业务成功码为 200。 */
class CodeResponse<D = unknown> extends AxpResponse<D> {
  /** 业务成功码是 200。 */
  get ok(): boolean {
    return this.status < 300 && this.code === 200;
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
    expectTypeOf(api.get("/pet")({ id: 1 }, { throws: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, { /** name 字段。 */ name: string }>>>();
    expectTypeOf(api.get("/empty", { wrap: true })()).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.request<number>({ url: "/escape" })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.request<number>({ wrap: true })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.request<number>({ throws: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
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
    expectTypeOf(api.get("/x", { throws: false })<number>(undefined, { wrap: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
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
    expectTypeOf(api.get("/x")<number>(undefined, { throws: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>()).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>(undefined, { throws: true })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x", { throws: true })<number>(undefined, { throws: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>(undefined, { throws: undefined })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
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
          delay: /** 延迟函数的第三个参数同样是自定义响应，末位是上下文。 */ (attempt, max, r, ctx) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(ctx).toEqualTypeOf<AxpContext<TestResponse>>();
            return r.traceId ? attempt : max;
          },
          respectRetryAfter: /** 函数形态的末位同样是上下文。 */ (r, ctx) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(ctx).toEqualTypeOf<AxpContext<TestResponse>>();
            return true;
          },
        }),
        axpAuth({
          tokenManager: tokens,
          onRefresh: /** 刷新回调收到自定义响应、会话管理器与上下文。 */ (r, tm, ctx) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(tm).toEqualTypeOf<ITokenManager>();
            expectTypeOf(ctx).toEqualTypeOf<AxpContext<TestResponse>>();
            return r.traceId;
          },
          onAccessExpired: /** 过期通知收到自定义响应与上下文。 */ (r, _tm, ctx) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(ctx).toEqualTypeOf<AxpContext<TestResponse>>();
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
          shouldCache: /** 写入判定收到自定义响应与上下文。 */ (r, ctx) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(ctx).toEqualTypeOf<AxpContext<TestResponse>>();
            return r.traceId !== "";
          },
        }),
      ],
    });
    // 旧写法（少一个参数的回调）仍可赋值。
    axpRetry<TestResponse>({ delay: /** 只收 attempt。 */ (attempt) => attempt, respectRetryAfter: /** 只收响应。 */ (r) => r.ok });
    axpAuth<TestResponse>({ tokenManager: tokens, onRefresh: /** 只收响应。 */ (r) => r.ok, onAccessExpired: /** 不收参数。 */ () => undefined });
    axpCache<TestResponse>({ shouldCache: /** 只收响应。 */ (r) => r.ok });
    axpMock<TestResponse>({ fallbackWhen: /** 只收响应。 */ (r) => r.ok });
    axpMock<TestResponse>({
      fallbackWhen: /** 回落判定末位是上下文。 */ (r, ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<AxpContext<TestResponse>>();
        return r.ok;
      },
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

it("[core.fn.createAxp][core.opt.plugins][core.cb.reject] 不写泛型时 R 只由 response 工厂决定：内联与单独定义的插件都按默认响应装配", /** 编译期契约：plugins 与 reject 不参与推断 R。 */ () => {
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

it("[core.opt.plugins][core.method.use] 不写泛型的自定义插件按默认响应声明，能直接装进默认客户端", /** 编译期契约：AxpPlugin 等插件作者类型的默认 R 与客户端一致。 */ () => {
  /** 只编译调用示例，避免发送真实网络请求。 */
  function contracts() {
    const timing: AxpPlugin = {
      name: "timing",
      /** 透传内层结果，响应类型是默认响应。 */
      async handle(ctx, next) {
        expectTypeOf(ctx.request.url).toEqualTypeOf<string | undefined>();
        const response = await next();
        expectTypeOf(response).toEqualTypeOf<AxpResponse>();
        return response;
      },
    };
    const api = createAxp({ plugins: [timing] });
    api.use(timing);
    // @ts-expect-error 默认响应的自定义插件不能装进自定义响应的客户端。
    createAxp<unknown, TestResponse>({ response: customResponse(), plugins: [timing] });
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.fn.axpResponse][core.prop.ok][core.prop.status] 子类覆盖 ok getter 后仍满足 IAxpResponse，工厂与客户端按子类推断", /** 编译期契约：判定的开放点是 getter 本身。 */ () => {
  /** 只编译类型调用。 */
  function contracts() {
    expectTypeOf<CodeResponse>().toExtend<IAxpResponse>();
    expectTypeOf<CodeResponse["ok"]>().toEqualTypeOf<boolean>();
    expectTypeOf<CodeResponse["status"]>().toEqualTypeOf<number>();
    expectTypeOf<CodeResponse["code"]>().toEqualTypeOf<number>();
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

/** 带同名业务字段 error 的自定义响应。 */
interface IBizResponse extends IAxpResponse {
  /** 业务错误文案，与原生 error 同名。 */
  readonly error: string;
}
/** 带原生数据的返回类型简写。 */
type Native<D> = WithNative<WithData<TestResponse, D>>;

it("[core.req.raw] raw:true 返回带原生数据的响应副本，未写时没有 raw", /** 仅编译类型调用。 */ () => {
  /** 仅编译类型调用。 */
  async function contracts() {
    const api = createAxp<unknown, TestResponse>({ response: customResponse() });
    const r = api.get("/x")<number>(undefined, { raw: true });
    expectTypeOf(r).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf<Awaited<typeof r>["raw"]>().toEqualTypeOf<AxiosResponse | undefined>();
    expectTypeOf<Awaited<typeof r>["error"]>().toEqualTypeOf<unknown>();
    expectTypeOf<Awaited<typeof r>["request"]>().toEqualTypeOf<Readonly<AxpRequestConfig>>();
    expectTypeOf<Awaited<typeof r>["traceId"]>().toEqualTypeOf<string>();
    // 不写 raw 时响应类型上没有 raw。
    void api
      .get("/x")<number>(undefined, { wrap: true })
      .then((w) => {
        // @ts-expect-error 未开启 raw 不应有 raw 字段。
        void w.raw;
      });
    // raw 与 wrap:false 同写，raw 优先。
    expectTypeOf(api.get("/x")<number>(undefined, { raw: true, wrap: false })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.get("/x")<number>(undefined, { raw: true, wrap: false, throws: true })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.get("/x", { raw: true, wrap: false })<number>()).toEqualTypeOf<Promise<Native<number>>>();
    // throws:false 与 raw 组合。
    expectTypeOf(api.get("/x")<number>(undefined, { raw: true, throws: false })).toEqualTypeOf<Promise<WithNative<AxpResult<TestResponse, number>>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>(undefined, { raw: true })).toEqualTypeOf<Promise<WithNative<AxpResult<TestResponse, number>>>>();
    // 方法级 raw 与调用级覆盖。
    expectTypeOf(api.get("/x", { raw: true })<number>()).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.get("/x", { raw: true })<number>(undefined, { wrap: false })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.get("/x", { raw: true })<number>(undefined, { throws: false })).toEqualTypeOf<Promise<WithNative<AxpResult<TestResponse, number>>>>();
    expectTypeOf(api.get("/x", { raw: true })<number>(undefined, { wrap: true })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.get("/x", { raw: true })<number>(undefined, { raw: false })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x", { raw: true })<number>(undefined, { raw: false, wrap: true })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { raw: true })<number>(undefined, { raw: false, throws: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { raw: true })<number>(undefined, { raw: false, wrap: false, throws: true })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x", { raw: true })<number>(undefined, { raw: undefined })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.get("/x", { raw: false })<number>(undefined, { raw: true })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, { raw: false })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, { raw: false, wrap: false })).toEqualTypeOf<Promise<number>>();
    // 宽 boolean 返回联合，不断言成数据。
    const flag = Math.random() > 0.5;
    // 宽 raw 与同次调用的 wrap/throws 一起计算。
    expectTypeOf(api.get("/x")<number>(undefined, { raw: flag, wrap: true })).toEqualTypeOf<Promise<Native<number> | WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x")<number>(undefined, { raw: flag, throws: false })).toEqualTypeOf<Promise<WithNative<AxpResult<TestResponse, number>> | AxpResult<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { throws: false })<number>(undefined, { raw: flag, throws: true })).toEqualTypeOf<Promise<Native<number> | number>>();
    expectTypeOf(api.get("/x")<number>(undefined, { raw: flag, wrap: false, throws: true })).toEqualTypeOf<Promise<Native<number> | number>>();
    // 方法级宽 raw 不再推成纯数据。
    expectTypeOf(api.get("/x", { raw: flag })<number>()).toEqualTypeOf<Promise<Native<number> | number>>();
    expectTypeOf(api.get("/x", { raw: flag, wrap: true })<number>()).toEqualTypeOf<Promise<Native<number> | WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x", { raw: flag })<number>(undefined, { raw: false })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/x", { raw: flag })<number>(undefined, { raw: true })).toEqualTypeOf<Promise<Native<number>>>();
    // 宽 wrap/throws 返回联合。
    expectTypeOf(api.get("/x")<number>(undefined, { wrap: flag })).toEqualTypeOf<Promise<WithData<TestResponse, number> | number>>();
    expectTypeOf(api.get("/x")<number>(undefined, { throws: flag })).toEqualTypeOf<Promise<AxpResult<TestResponse, number> | number>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, { throws: flag })).toEqualTypeOf<Promise<AxpResult<TestResponse, number> | WithData<TestResponse, number>>>();
    expectTypeOf(api.get("/x")<number>(undefined, { wrap: flag, throws: flag })).toEqualTypeOf<Promise<AxpResult<TestResponse, number> | number>>();
    expectTypeOf(api.request<number>({ wrap: flag })).toEqualTypeOf<Promise<WithData<TestResponse, number> | number>>();
    expectTypeOf(api.request<number>({ throws: flag })).toEqualTypeOf<Promise<AxpResult<TestResponse, number> | number>>();
    expectTypeOf(api.get("/x")<number>(undefined, { raw: flag })).toEqualTypeOf<Promise<Native<number> | number>>();
    const config: AxpRequestConfig = {};
    expectTypeOf(api.get("/x")<number>(undefined, config)).toEqualTypeOf<Promise<Native<number> | number>>();
    expectTypeOf(api.get("/x", { wrap: true })<number>(undefined, config)).toEqualTypeOf<Promise<Native<number> | WithData<TestResponse, number>>>();
    // request() 的 raw 重载。
    expectTypeOf(api.request<number>({ raw: true })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.request<number>({ raw: true, wrap: false })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.request<number>({ raw: true, throws: false })).toEqualTypeOf<Promise<WithNative<AxpResult<TestResponse, number>>>>();
    expectTypeOf(api.request<number>({ raw: false })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.request<number>({ raw: false, wrap: true })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.request<number>({ raw: flag })).toEqualTypeOf<Promise<Native<number> | number>>();
    expectTypeOf(api.request<number>({ raw: flag, wrap: true })).toEqualTypeOf<Promise<WithData<TestResponse, number> | Native<number>>>();
    expectTypeOf(api.request<number>(config)).toEqualTypeOf<Promise<Native<number> | number>>();
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.req.raw] WithNative 替换同名业务字段而不是交叉成 never", /** 仅编译类型调用。 */ () => {
  /** 仅编译类型调用。 */
  async function contracts(biz: AxpClient<unknown, IBizResponse>) {
    expectTypeOf<IBizResponse["error"]>().toEqualTypeOf<string>();
    expectTypeOf<WithNative<IBizResponse>["error"]>().toEqualTypeOf<unknown>();
    expectTypeOf<WithNative<IBizResponse>["raw"]>().toEqualTypeOf<AxiosResponse | undefined>();
    expectTypeOf<WithNative<IBizResponse>["data"]>().toEqualTypeOf<unknown>();
    const native = await biz.request<number>({ raw: true });
    expectTypeOf(native.error).toEqualTypeOf<unknown>();
    expectTypeOf(native.data).toEqualTypeOf<number>();
    const wrapped = await biz.request<number>({ wrap: true });
    expectTypeOf(wrapped.error).toEqualTypeOf<string>();
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.req.throws][core.req.raw][core.opt.statusOf] ok 收窄失败数据且保留自定义响应字段", /** 只编译不发送网络请求。 */ () => {
  /** 校验字面量、宽开关与派生上下文类型。 */
  async function contracts(flag: boolean) {
    const api = createAxp<ISchema, TestResponse>({
      response: customResponse(),
      statusOf: /** 回调只接收自定义 R。 */ (r) => {
        expectTypeOf(r).toEqualTypeOf<TestResponse>();
        return r.status;
      },
    });
    const result = await api.get("/pet")({ id: 1 }, { throws: false });
    expectTypeOf(result.traceId).toEqualTypeOf<string>();
    if (result.ok) expectTypeOf(result.data).toEqualTypeOf<{ /** 名称。 */ name: string }>();
    else {
      expectTypeOf(result.data).toEqualTypeOf<unknown>();
      // @ts-expect-error 失败数据不可当作成功模型读取。
      void result.data.name;
    }
    const raw = await api.get("/pet", { throws: false })({ id: 1 }, { raw: true });
    expectTypeOf(raw.raw).toEqualTypeOf<AxiosResponse | undefined>();
    if (raw.ok) expectTypeOf(raw.data).toEqualTypeOf<{ /** 名称。 */ name: string }>();
    else expectTypeOf(raw.data).toEqualTypeOf<unknown>();
    expectTypeOf(api.request<number>({ raw: true, throws: true })).toEqualTypeOf<Promise<WithNative<WithData<TestResponse, number>>>>();
    expectTypeOf(api.request<number>({ wrap: true, throws: true })).toEqualTypeOf<Promise<WithData<TestResponse, number>>>();
    expectTypeOf(api.request<number>({ throws: true })).toEqualTypeOf<Promise<number>>();
    const escape = await api.request<{ /** 名称。 */ name: string }>({ raw: true, throws: false });
    if (escape.ok) expectTypeOf(escape.data).toEqualTypeOf<{ /** 名称。 */ name: string }>();
    else expectTypeOf(escape.data).toEqualTypeOf<unknown>();
    expectTypeOf(api.request<number>({ throws: false, raw: flag })).toEqualTypeOf<Promise<AxpResult<TestResponse, number> | WithNative<AxpResult<TestResponse, number>>>>();
    expectTypeOf(api.request<number>({ raw: true, throws: flag })).toEqualTypeOf<Promise<WithNative<AxpResult<TestResponse, number> | WithData<TestResponse, number>>>>();
    expectTypeOf(api.get("/empty")(undefined, { raw: true, throws: flag })).toEqualTypeOf<Promise<WithNative<AxpResult<TestResponse, number> | WithData<TestResponse, number>>>>();
    expectTypeOf(api.get("/empty", { throws: false })(undefined, { wrap: true })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.req.wrap][core.req.throws] Schema 默认泛型只解析一次，显式数据与请求体泛型优先", /** 只编译泛型边界。 */ () => {
  /** 校验显式 unknown/any、请求体必填性以及错误实参不会反推泛型。 */
  function contracts() {
    const api = createAxp<ISchema, TestResponse>({ response: customResponse() });
    expectTypeOf(api.get("/pet")<number>({ id: 1 })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/pet")<number, string>("body")).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/pet")<unknown>({ id: 1 })).toEqualTypeOf<Promise<unknown>>();
    expectTypeOf(api.get("/pet")<any>({ id: 1 })).toEqualTypeOf<Promise<any>>();
    expectTypeOf(api.get("/pet")<number, unknown>()).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/pet")<number, undefined>()).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/pet")<number, any>({ arbitrary: true })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/pet")<number, string>("body", { throws: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
    // @ts-expect-error 显式请求体泛型仍校验参数。
    void api.get("/pet")<number, string>({ id: 1 });
    // @ts-expect-error any 请求体沿用必须占位的契约。
    void api.get("/pet")<number, any>();
    // @ts-expect-error 显式响应泛型不能绕过 schema 请求体校验。
    void api.get("/pet")<number>({ id: "wrong" });
    // @ts-expect-error 普通调用优先的签名不能吞掉非法配置。
    void api.get("/pet")({ id: 1 }, { throws: "false" });
  }
  expect(contracts).toBeTypeOf("function");
});

it("[core.req.throws][core.req.raw] 合并 raw 缺省与 false 后仍保留继承、覆盖和失败收窄", /** 只编译开关边界。 */ () => {
  /** 校验普通、原生、方法级继承以及 request 的宽开关。 */
  async function contracts(flag: boolean) {
    const api = createAxp<ISchema, TestResponse>({ response: customResponse() });
    expectTypeOf(api.get("/empty", { raw: false, throws: false })()).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
    expectTypeOf(api.get("/empty", { raw: false, throws: false })(undefined, { throws: true })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/empty", { raw: true, throws: false })(undefined, { raw: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
    expectTypeOf(api.get("/empty", { raw: true, throws: false })(undefined, { raw: false, throws: true })).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.get("/empty", { raw: flag, throws: false })(undefined, { raw: false })).toEqualTypeOf<Promise<AxpResult<TestResponse, number>>>();
    expectTypeOf(api.get("/empty", { raw: true, throws: false })(undefined, { throws: true })).toEqualTypeOf<Promise<Native<number>>>();
    expectTypeOf(api.get("/empty", { throws: flag })(undefined, { wrap: true })).toEqualTypeOf<Promise<AxpResult<TestResponse, number> | WithData<TestResponse, number>>>();
    expectTypeOf(api.request<number>({ raw: false, wrap: true, throws: flag })).toEqualTypeOf<Promise<AxpResult<TestResponse, number> | WithData<TestResponse, number>>>();
    expectTypeOf(api.request<number>({ raw: flag, wrap: true, throws: flag })).toEqualTypeOf<
      Promise<AxpResult<TestResponse, number> | WithData<TestResponse, number> | WithNative<AxpResult<TestResponse, number> | WithData<TestResponse, number>>>
    >();
    const inherited = await api.get("/pet", { throws: false })({ id: 1 });
    if (inherited.ok) expectTypeOf(inherited.data).toEqualTypeOf<{ /** 名称。 */ name: string }>();
    else expectTypeOf(inherited.data).toEqualTypeOf<unknown>();
    const native = await api.get("/pet", { raw: true, throws: false })({ id: 1 });
    if (native.ok) {
      expectTypeOf(native.data).toEqualTypeOf<{ /** 名称。 */ name: string }>();
      expectTypeOf(native.request).toEqualTypeOf<Readonly<AxpRequestConfig>>();
    } else {
      expectTypeOf(native.data).toEqualTypeOf<unknown>();
      expectTypeOf(native.raw).toEqualTypeOf<AxiosResponse | undefined>();
      // @ts-expect-error 原生失败分支也不能读取成功模型。
      void native.data.name;
    }
    const methodConfig: AxpRequestConfig = { raw: true, throws: false };
    expectTypeOf(api.get("/empty", methodConfig)()).toEqualTypeOf<Promise<number>>();
  }
  expect(contracts).toBeTypeOf("function");
});
