import { AxiosError, AxiosHeaders, CanceledError, create as createAxios, type AxiosResponse } from "axios";
import { assert, expect, it, vi } from "vitest";
import { settle } from "../../src/client";
import { AxpContext, NO_LOG } from "../../src/context";
import { AXP_FAILURE, AxpResponse, axpResponse, failureOf, guardFactory, messageOf, retryAfterOf, withRetryAfter, type IAxpResponse } from "../../src/response";
import { createTransport } from "../../src/transport";
import type { AxpRequestConfig } from "../../src/types";
import { createTestClient } from "../helpers/client";
import { testContext } from "../helpers/context";

/** 轻量请求的固定地址。 */
const URL = "/slim";
/** 传输与合成共用的方法。 */
const METHOD = "post";
/** 服务端等待的原始秒数。 */
const AFTER = "2";
/** 异常身份和序列化脱敏共用的内容。 */
const SECRET = "private-error-content";
/** 构造带完整请求配置的原生响应。 */
function rawResponse() {
  const config = { method: METHOD, url: URL, headers: new AxiosHeaders(), data: { secret: SECRET }, params: { page: 1 } } satisfies AxpRequestConfig;
  return { status: 503, statusText: "", data: { code: 1, data: null }, headers: {}, config } satisfies AxiosResponse;
}

it("[core.prop.request][core.prop.message] 默认响应仅保留轻量配置，raw 只用于解析", /** 各构造入口都解除完整配置引用。 */ () => {
  const raw = rawResponse();
  const ctx = testContext(raw.config);
  const factory = axpResponse();
  const responses = [new AxpResponse({ raw, request: raw.config }), factory.fromResponse(raw, ctx), factory.fromError(new AxiosError(SECRET, undefined, raw.config), ctx), ctx.fail({ request: raw.config })];
  for (const response of responses) {
    expect(response.request).toEqual({ method: METHOD, url: URL });
    expect(Object.keys(response.request).sort()).toEqual(["method", "url"]);
    expect(response.request).not.toBe(raw.config);
    expect(response.message).toBeTypeOf("string");
    expect(response).not.toHaveProperty("raw");
    expect(response).not.toHaveProperty("error");
  }
  expect(new AxpResponse({ raw }).data).toBeNull();
  expect(new AxpResponse({ message: null }).message).toBeNull();
});

it("[core.prop.request] 自定义 adapter 不返回 config 时使用当前请求轻量视图并正常落定", /** adapter 只需提供业务体、状态和响应头。 */ async () => {
  const { api } = createTestClient([], {}, /** 模拟没有 config 的适配器。 */ async () => ({ data: { code: 0, data: SECRET }, status: 200, headers: {} }) as AxiosResponse);
  const response = await api.request({ method: METHOD, url: URL, data: { secret: SECRET }, headers: { caller: "current" }, wrap: true });
  expect(response.ok).toBe(true);
  expect(response.data).toBe(SECRET);
  expect(response.request).toEqual({ method: METHOD, url: URL });
  expect(failureOf(response)).toBeUndefined();
  expect(api.pending()).toBe(0);
  api.dispose();
});

it.each([new AxiosError(SECRET), new AxiosError(SECRET, "ETIMEDOUT"), new CanceledError(SECRET)])(
  "[core.fn.failureOf] 传输失败不携带原始异常：%s",
  /** 归一化结果和派生结果只保存失败类别。 */ (error) => {
    const ctx = testContext();
    const response = guardFactory(axpResponse()).fromError(error, ctx);
    for (const result of [response, ctx.fail({ from: response, error })]) {
      expect(result).not.toHaveProperty("error");
      expect(result).not.toHaveProperty("raw");
      expect(failureOf(result)).not.toHaveProperty("error");
    }
  },
);

it.each([false, true])(
  "[core.fn.failureOf][core.method.toJSON] internal 异常经标记继承，JSON 只投影类型和原因：%s",
  /** 完整工厂也无法丢弃内核失败事实。 */ (custom) => {
    const factory = axpResponse();
    const ctx = testContext({}, custom ? { ...factory, /** 模拟完全忽略 init 的工厂。 */ fail: () => new AxpResponse() } : factory);
    const error = { secret: SECRET };
    const original = ctx.fail({ failure: "internal", reason: "bug", error });
    const derived = ctx.fail({ from: original });
    expect(derived).not.toBe(original);
    for (const result of [original, derived]) {
      expect(result).not.toHaveProperty("error");
      expect(failureOf(result)?.error).toBe(error);
      expect(Object.isFrozen(failureOf(result))).toBe(true);
      expect(Object.getOwnPropertyDescriptor(result, AXP_FAILURE)?.enumerable).toBe(false);
      expect(Reflect.get(result.toJSON(), "failure")).toEqual({ type: "internal", reason: "bug" });
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain('"error"');
      let thrown: unknown;
      try {
        settle(result, ctx, {});
      } catch (cause) {
        thrown = cause;
      }
      expect(thrown).toBe(error);
    }
    expect(failureOf(ctx.fail({ from: original, error: undefined }))?.error).toBeUndefined();
    const replacement = new Error(SECRET);
    expect(failureOf(ctx.fail({ from: original, error: replacement }))?.error).toBe(replacement);
    expect(failureOf(ctx.fail({ from: original, failure: "auth" }))).not.toHaveProperty("error");
  },
);

it("[core.fn.guardFactory] 派生工厂故障保留已有 internal，显式改类时保留新工厂异常", /** 原异常优先规则覆盖继承和显式清除。 */ () => {
  const bug = new Error(SECRET);
  const original = testContext().fail({ failure: "internal", error: bug });
  const factoryBug = new TypeError("factory-copy");
  const ctx = testContext(
    {},
    {
      ...axpResponse(),
      /** 所有派生都模拟工厂故障。 */ fail() {
        throw factoryBug;
      },
    },
  );
  expect(failureOf(ctx.fail({ from: original }))?.error).toBe(bug);
  expect(failureOf(ctx.fail({ from: original, failure: "internal" }))?.error).toBe(bug);
  expect(failureOf(ctx.fail({ from: original, failure: "internal", error: undefined }))?.error).toBeUndefined();
  expect(failureOf(ctx.fail({ from: original, failure: "auth" }))?.error).toBe(factoryBug);
  expect(failureOf(ctx.fail({ failure: "internal" }))?.error).toBeUndefined();
});

it.each([undefined, null, "", AFTER, 1, false])(
  "[core.fn.messageOf] 结构化消息只接受字符串与 null：%s",
  /** 既支持接口缺省，也允许业务类的原型消息。 */ (message) => {
    const response: IAxpResponse = { ok: false, status: 503, code: 0, data: null };
    expect(messageOf(response)).toBeUndefined();
    Object.defineProperty(response, "message", { value: message });
    const expected = typeof message === "string" || message === null ? message : undefined;
    expect(messageOf(response)).toBe(expected);
    const inherited: IAxpResponse = { ...response };
    Object.setPrototypeOf(inherited, response);
    expect(messageOf(inherited)).toBe(expected);
  },
);

it("[core.type.IAxpResponse][core.method.fail] 接口实现和派生不被补 message，显式业务消息仍可传入", /** 只保留四字段的实现无需提供诊断字段。 */ () => {
  const factory = axpResponse<IAxpResponse>({
    /** 仅实现四个基础字段，显式业务消息才成为扩展字段。 */
    create(init) {
      return { ok: true, status: init.status ?? 200, code: typeof init.code === "number" ? init.code : 0, data: init.data ?? null, ...(init.message === undefined ? {} : { message: init.message }) };
    },
  });
  const { api } = createTestClient<IAxpResponse>([], { response: factory });
  const ctx = new AxpContext({ id: 1, client: api, request: {}, signal: new AbortController().signal, log: NO_LOG, factory });
  const response = factory.fail({}, ctx);
  const derived = factory.fail({ from: response }, ctx);
  expect(Object.keys(response)).toEqual(["ok", "status", "code", "data"]);
  expect(derived).not.toHaveProperty("message");
  expect(messageOf(factory.fail({ from: derived, message: null }, ctx))).toBeNull();
  api.dispose();
});

it.each(["plain", "getter", "number", "missing", "invalid"] as const)(
  "[core.fn.retryAfterOf] 传输只保留重试头小事实，派生继承：%s",
  /** 不保留完整原生头，独立 Symbol 不可枚举。 */ async (mode) => {
    const raw = rawResponse();
    const value = mode === "invalid" ? false : mode === "number" ? 2 : AFTER;
    if (mode === "missing") Reflect.deleteProperty(raw, "headers");
    else raw.headers = mode === "getter" ? new AxiosHeaders({ "Retry-After": AFTER }) : { "retry-after": value };
    const axios = createAxios();
    vi.spyOn(axios, "request").mockResolvedValue(raw);
    const ctx = testContext();
    const response = await createTransport(axios, guardFactory(axpResponse()))(ctx);
    const expected = mode === "missing" || mode === "invalid" ? undefined : AFTER;
    expect(retryAfterOf(response)).toBe(expected);
    const derived = ctx.fail({ from: response });
    expect(retryAfterOf(derived)).toBe(expected);
    expect(derived).not.toHaveProperty("raw");
    expect(Object.keys(derived)).not.toContain("retry-after");
    expect(JSON.stringify(derived)).not.toContain("retry-after");
    if (expected !== undefined) {
      const symbol = Object.getOwnPropertySymbols(response).find(/** 头事实与失败标记独立。 */ (key) => Reflect.get(response, key) === AFTER)!;
      expect(Object.getOwnPropertyDescriptor(response, symbol)?.enumerable).toBe(false);
    }
  },
);

it("[core.fn.retryAfterOf] Axios HTTP 异常也保留重试头，自定义工厂派生不丢事实", /** 原生异常留在上下文，头事实随响应流转。 */ async () => {
  const raw = rawResponse();
  raw.headers = { "retry-after": AFTER };
  const error = new AxiosError(SECRET, undefined, raw.config, undefined, raw);
  const axios = createAxios();
  vi.spyOn(axios, "request").mockRejectedValue(error);
  const ctx = testContext({}, { ...axpResponse(), /** 模拟不复制任何 Symbol 的工厂。 */ fail: () => new AxpResponse() });
  const response = await createTransport(axios, guardFactory(axpResponse()))(ctx);
  expect(ctx.native.error).toBe(error);
  expect(retryAfterOf(response)).toBe(AFTER);
  expect(retryAfterOf(ctx.fail({ from: response }))).toBe(AFTER);
  expect(failureOf(response)).not.toHaveProperty("error");
});

it("[core.fn.withRetryAfter] undefined 不写入私有头事实，也不清除已有值", /** 缺省头不分配 Symbol，已有头按契约保留。 */ () => {
  const response = new AxpResponse();
  const symbols = Object.getOwnPropertySymbols(response);
  expect(withRetryAfter(response, undefined)).toBe(response);
  expect(retryAfterOf(response)).toBeUndefined();
  expect(Object.getOwnPropertySymbols(response)).toEqual(symbols);
  withRetryAfter(response, AFTER);
  withRetryAfter(response, undefined);
  expect(retryAfterOf(response)).toBe(AFTER);
});

it.each(["frozen", "nonextensible", "error"] as const)(
  "[core.fn.withRetryAfter][core.fn.guardFactory] 头事实挂载失败归为 internal 并保留原异常：%s",
  /** 冻结成功响应和不可扩展异常响应都在工厂保护范围内。 */ async (mode) => {
    const raw = rawResponse();
    raw.headers = { "retry-after": AFTER };
    const ctx = testContext();
    const transportError = new AxiosError(SECRET, undefined, raw.config, undefined, raw);
    const target = mode === "error" ? axpResponse().fromError(transportError, ctx) : new AxpResponse({ status: 200 });
    if (mode === "frozen") Object.freeze(target);
    else Object.preventExtensions(target);
    const factory = guardFactory({
      ...axpResponse(),
      /** 返回不能挂新字段的成功响应。 */ fromResponse: () => target,
      /** 已有失败标记可重定义，新增的重试 Symbol 必须由保护层处理。 */ fromError: () => target,
    });
    const axios = createAxios();
    const request = vi.spyOn(axios, "request");
    if (mode === "error") request.mockRejectedValue(transportError);
    else request.mockResolvedValue(raw);
    const response = await createTransport(axios, factory)(ctx);
    const failure = failureOf(response);
    expect(failure?.type).toBe("internal");
    assert(failure?.error instanceof TypeError);
    expect(response).not.toBe(target);
    expect(retryAfterOf(response)).toBeUndefined();
    let thrown: unknown;
    try {
      settle(response, ctx, {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure.error);
  },
);
