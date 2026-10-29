import { AxiosError, AxiosHeaders, CanceledError, type AxiosResponse } from "axios";
import { describe, expect, it, vi } from "vitest";
import { AXP_FAILURE, AXP_RESPONSE, AxpResponse, axpResponse, failureOf, isAxpCancel, isAxpResponse, type AxpFailureType } from "../../src/response";
import { testContext } from "../helpers/context";

/** 成功 HTTP 状态。 */
const OK = 200;
/** 服务端失败状态。 */
const BAD = 500;
/** 业务鉴权码。 */
const UNAUTHORIZED = 401;
/** 构造原始响应样例。 */
function raw(data: unknown, status = OK, headers = {}): AxiosResponse {
  return { data, status, headers, statusText: "", config: { headers: new AxiosHeaders() } };
}

describe("响应判定", /** 默认响应的基础契约。 */ () => {
  it("[core.fn.axpResponse] 传输异常保留实际请求，构造字段和状态边界", /** 验证默认字段、空数据和状态边界。 */ () => {
    const request = { url: "/actual", headers: new AxiosHeaders() };
    expect(axpResponse().fromError(new AxiosError("offline", undefined, request), testContext()).request).toBe(request);
    for (const status of [NaN, -1, 65_536, 199, 300]) expect(new AxpResponse({ status }).ok).toBe(false);
    expect(new AxpResponse({ status: 299 }).ok).toBe(true);
    for (const code of ["0", "", -1]) expect(new AxpResponse({ status: OK, code }).ok).toBe(false);
    for (const data of [false, 0, "", null, undefined]) {
      const response = axpResponse().fromResponse(raw({ code: 0, data, message: "" }), testContext());
      expect(response.data).toBe(data ?? null);
      expect(response.message).toBe("");
    }
    expect(new AxpResponse()).toMatchObject({ status: 0, ok: false, code: 0, data: null, message: "", request: {} });
  });
  it.each([
    [OK, undefined, true],
    [OK, 0, true],
    [OK, "0000", true],
    [OK, UNAUTHORIZED, false],
    [OK, "401", false],
    [OK, 399, false],
    [OK, 600, false],
    [BAD, 0, false],
    [199, undefined, false],
    [300, undefined, false],
  ])(
    "[core.prop.ok][core.prop.status] HTTP=%s code=%s 成功=%s",
    /** HTTP 状态不受业务码影响。 */ (status, code, ok) => {
      const response = new AxpResponse({ status, code });
      expect(response.ok).toBe(ok);
      expect(response.status).toBe(status);
      expect(failureOf(response)).toBeUndefined();
      expect(Object.hasOwn(response, "ok")).toBe(false);
    },
  );
  it("[core.fn.axpResponse][core.method.parse] 默认信封与非信封，缺字段补默认值", /** 信封只需 code 和 data/message 之一。 */ () => {
    const factory = axpResponse();
    const ctx = testContext();
    for (const body of [null, undefined, "", "text", [1], {}, { code: 0 }]) expect(factory.fromResponse(raw(body), ctx).data).toEqual(body ?? null);
    expect(factory.fromResponse(raw({ code: 0, message: "denied" }), ctx)).toMatchObject({ code: 0, data: null, message: "denied" });
    expect(factory.fromResponse(raw({ code: undefined, data: undefined }), ctx)).toMatchObject({ code: 0, data: null, message: "" });
    expect(factory.fromResponse(raw({ code: 0, data: 1, message: null }), ctx).message).toBeNull();
  });
  it.each([
    [new CanceledError(), "cancel"],
    [new DOMException("aborted", "AbortError"), "cancel"],
    [new AxiosError("deadline", "ETIMEDOUT"), "timeout"],
    [new AxiosError("timeout exceeded", "ECONNABORTED"), "timeout"],
    [new AxiosError("aborted", "ECONNABORTED"), "network"],
    [new AxiosError("bad", "ERR_BAD_RESPONSE"), "parse"],
    [new AxiosError("offline"), "network"],
    [new TypeError("bug"), "internal"],
    ["bug", "internal"],
  ] as const)(
    "[core.fn.axpResponse] 分类 %s → %s",
    /** 分类由内核规则决定。 */ (error, type) => {
      const response = axpResponse().fromError(error, testContext());
      expect([response.ok, response.status, response.code, response.data, response.error]).toEqual([false, 0, 0, null, error]);
      expect(failureOf(response)?.type).toBe(type);
      expect(Object.getOwnPropertyDescriptor(response, AXP_FAILURE)?.enumerable).toBe(false);
    },
  );
  it.each([
    [true, OK, "application/json", "{broken", "parse"],
    [true, OK, "text/html", "<html>", "parse"],
    [true, OK, "text/plain", "text", undefined],
    [true, OK, "", "text", undefined],
    [true, OK, "application/json", "  ", undefined],
    [true, BAD, "application/json", "broken", undefined],
    [true, OK, "application/json", {}, undefined],
    [false, OK, "application/json", "broken", undefined],
  ] as const)(
    "[core.opt.expectJson] expect=%s status=%s type=%s body=%s",
    /** 解析失败独立于 HTTP 状态。 */ (expectJson, status, contentType, data, type) => {
      const response = axpResponse({ expectJson }).fromResponse(raw(data, status, { "content-type": contentType }), testContext());
      expect(failureOf(response)?.type).toBe(type);
      expect(response.status).toBe(status);
      expect(response.ok).toBe(type === undefined && status === OK);
    },
  );
  it("[core.cb.create] 子类 getter 仅在收到响应时求值，失败强制遮住 getter", /** 用户成功判定不能改变失败事实。 */ () => {
    const reads = vi.fn();
    /** 自定义成功码。 */
    class Custom extends AxpResponse {
      /** 只有业务码 200 成功。 */
      override get ok() {
        reads();
        return this.code === OK;
      }
    }
    const factory = axpResponse<Custom>({ type: Custom });
    for (const failure of ["network", "timeout", "cancel", "parse", "auth", "internal"] as AxpFailureType[]) {
      const response = factory.fail({ failure }, testContext());
      expect([response.ok, response.status, failureOf(response)?.type]).toEqual([false, 0, failure]);
    }
    expect(reads).not.toHaveBeenCalled();
    const response = factory.fromResponse(raw({ code: OK, data: 1 }), testContext());
    expect(response.ok).toBe(true);
    expect(failureOf(response)).toBeUndefined();
    expect(reads).toHaveBeenCalledOnce();
  });
  it("[core.cb.create][core.fn.isAxpResponse][core.const.AXP_RESPONSE] 普通对象补不可枚举品牌，跨副本品牌有效", /** 接口工厂也支持缺省业务字段。 */ () => {
    const factory = axpResponse({ create: /** 模拟未填充业务字段的使用者。 */ () => ({ ok: true, status: OK }) as AxpResponse });
    const response = factory.fail({ failure: "auth" }, testContext());
    expect(response).toMatchObject({ code: 0, data: null, message: "", ok: false });
    expect(isAxpResponse(response)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(response, AXP_RESPONSE)?.enumerable).toBe(false);
    expect(isAxpResponse({ [Symbol.for("axp.response")]: true })).toBe(true);
    for (const value of [new Error(), {}, null, undefined, 1, "response"]) {
      expect(isAxpResponse(value)).toBe(false);
      expect(failureOf(value)).toBeUndefined();
      expect(isAxpCancel(value)).toBe(false);
    }
    expect(isAxpCancel(factory.fail({ failure: "cancel" }, testContext()))).toBe(true);
  });
  it("[core.method.toJSON][core.method.fail] 派生字段完整且不改原响应", /** 派生保留事实和来源字段，显式字段覆盖来源。 */ () => {
    const factory = axpResponse();
    const original = factory.fromResponse(raw({ code: UNAUTHORIZED, data: 1, message: "denied" }), testContext());
    const derived = factory.fail({ from: original, stack: "callsite", data: undefined }, testContext());
    expect(derived).not.toBe(original);
    expect(original.stack).toBeUndefined();
    expect(derived.toJSON()).toMatchObject({ ok: false, status: OK, code: UNAUTHORIZED, message: "denied", data: null, stack: "callsite", request: {} });
    expect(derived.toJSON()).not.toHaveProperty("raw");
    expect(derived.toJSON()).not.toHaveProperty("error");
    expect(JSON.parse(JSON.stringify(new AxpResponse({ status: OK })))).toMatchObject({ ok: true, status: OK });
    const failed = factory.fail({ failure: "cancel", reason: "stop", message: "stop", error: "reason" }, testContext());
    expect(factory.fail({ from: failed }, testContext()).toJSON()).toMatchObject({ failure: { type: "cancel", reason: "stop" }, message: "stop" });
    expect(failureOf(factory.fail({ from: failed, reason: "other" }, testContext()))).toEqual({ type: "cancel", reason: "other" });
    expect(factory.fail({ from: failed, error: undefined }, testContext()).error).toBeUndefined();
    expect(factory.fail({ from: failed, error: "other" }, testContext()).error).toBe("other");
    expect(new AxpResponse({ from: original }).data).toBe(1);
  });
});
it("[core.opt.expectJson] 关闭守卫不读取响应头，缺失响应头不误判解析失败", /** 关闭守卫时不访问不必要的响应头。 */ () => {
  const ctx = testContext();
  const missing = { ...raw("text"), headers: undefined } as unknown as AxiosResponse;
  expect(axpResponse().fromResponse(missing, ctx).ok).toBe(true);
  expect(axpResponse({ expectJson: true }).fromResponse(missing, ctx).ok).toBe(true);
  const unreadable = {
    ...raw("text"),
    /** 不应读取的头。 */ get headers(): AxiosResponse["headers"] {
      throw new Error("headers read");
    },
  };
  expect(axpResponse().fromResponse(unreadable, ctx).data).toBe("text");
});
