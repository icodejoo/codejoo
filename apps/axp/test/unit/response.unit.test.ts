import { AxiosError, AxiosHeaders, CanceledError, type AxiosResponse } from "axios";
import { describe, expect, it, vi } from "vitest";
import { AXP_RESPONSE, AxpResponse, axpResponse, isAxpResponse } from "../../src/response";
import { testContext } from "../helpers/context";

/** 成功 HTTP 状态。 */
const OK = 200;
/** 失败 HTTP 状态。 */
const BAD = 500;
/** 业务鉴权状态。 */
const UNAUTHORIZED = 401;
/** 响应样例。 */
function raw(data: unknown, status = OK, headers = {}): AxiosResponse {
  return { data, status, headers, statusText: "", config: { headers: new AxiosHeaders() } };
}

describe("响应判定", /** 响应判定的用例集合。 */ () => {
  it("[core.fn.axpResponse] 传输异常保留实际请求，构造字段和状态边界", /** 传输异常保留实际请求，构造字段和状态边界。 */ () => {
    const request = { url: "/actual", headers: new AxiosHeaders() };
    const error = new AxiosError("offline", undefined, request);
    expect(axpResponse().fromError(error, testContext()).request).toBe(request);
    for (const httpStatus of [NaN, -1, 65_536])
      expect(new AxpResponse({ httpStatus }).ok).toBe(false);
    expect(new AxpResponse({ httpStatus: 299 }).ok).toBe(true);
    for (const code of ["0", "", -1])
      expect(new AxpResponse({ httpStatus: OK, code }).ok).toBe(false);
    for (const data of [false, 0, "", null, undefined]) {
      const response = axpResponse().fromResponse(
        raw({ code: 0, data, message: "" }),
        testContext(),
      );
      expect(response.data).toBe(data);
      expect(response.message).toBe("");
    }
    expect(new AxpResponse()).toMatchObject({
      httpStatus: 0,
      status: 0,
      ok: false,
      code: undefined,
      data: undefined,
    });
  });
  it.each([
    [OK, undefined, true, OK, "ok"],
    [OK, 0, true, OK, "ok"],
    [OK, "0000", true, OK, "ok"],
    [OK, UNAUTHORIZED, false, UNAUTHORIZED, "biz"],
    [OK, "401", false, OK, "biz"],
    [OK, 399, false, OK, "biz"],
    [OK, 600, false, OK, "biz"],
    [BAD, 0, false, BAD, "http"],
    [199, undefined, false, 199, "http"],
    [300, undefined, false, 300, "http"],
  ])(
    "[core.prop.ok][core.prop.status][core.prop.kind] http=%s code=%s",
    /** HTTP 状态与业务码组合下的 ok、status、kind 判定。 */ (
      httpStatus,
      code,
      ok,
      status,
      kind,
    ) => {
      const response = new AxpResponse({
        httpStatus: httpStatus as number,
        code: code as number | string | undefined,
      });
      expect([response.ok, response.status, response.kind]).toEqual([ok, status, kind]);
      for (const name of ["ok", "status", "kind"])
        expect(Object.prototype.hasOwnProperty.call(response, name)).toBe(false);
    },
  );
  it("[core.fn.axpResponse][core.opt.envelope] 信封识别、字段映射、关闭与非信封数据", /** 信封识别、字段映射、关闭与非信封数据。 */ () => {
    const ctx = testContext();
    const factory = axpResponse();
    const body = { code: 0, data: null };
    expect(factory.fromResponse(raw(body), ctx).data).toBeNull();
    expect(factory.fromResponse(raw({ code: 0, data: undefined }), ctx).data).toBeUndefined();
    for (const data of [null, "", "text", [1], {}, { code: 0 }])
      expect(factory.fromResponse(raw(data), ctx).data).toBe(data);
    expect(axpResponse({ envelope: false }).fromResponse(raw(body), ctx).data).toBe(body);
    const custom = axpResponse({ envelope: { code: "c", data: "d", message: "m" } }).fromResponse(
      raw({ c: "0000", d: 1, m: "done" }),
      ctx,
    );
    expect([custom.data, custom.message, custom.ok]).toEqual([1, "done", true]);
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
  ])(
    "[core.fn.axpResponse] 分类 %s → %s",
    /** 各类异常归入固定的失败类别。 */ (error, kind) => {
      const response = axpResponse().fromError(error, testContext());
      expect([
        response.ok,
        response.status,
        response.httpStatus,
        response.kind,
        response.error,
      ]).toEqual([false, 0, 0, kind, error]);
    },
  );
  it.each([
    [true, OK, "application/json", "{broken", "parse"],
    [true, OK, "text/html", "<html>", "parse"],
    [true, OK, "text/plain", "text", "ok"],
    [true, OK, "", "text", "ok"],
    [true, OK, "application/json", "  ", "ok"],
    [true, BAD, "application/json", "broken", "http"],
    [true, OK, "application/json", {}, "ok"],
    [false, OK, "application/json", "broken", "ok"],
  ])(
    "[core.opt.expectJson] expect=%s status=%s type=%s body=%s",
    /** expectJson 在不同状态码、媒体类型与响应体组合下的类别判定。 */ (
      expectJson,
      status,
      contentType,
      data,
      kind,
    ) => {
      const response = axpResponse({ expectJson: expectJson as boolean }).fromResponse(
        raw(data, status as number, { "content-type": contentType }),
        testContext(),
      );
      expect(response.kind).toBe(kind);
      expect(response.status).toBe(status);
    },
  );
  it("[core.cb.create] 子类 getter 仅在收到响应时求值，kind 跟随覆盖", /** 子类 getter 仅在收到响应时求值，kind 跟随覆盖。 */ () => {
    const reads = vi.fn();
    /** 覆盖判定的响应样例。 */
    class Custom extends AxpResponse {
      /** 自定义业务成功码。 */
      override get ok() {
        reads();
        return this.code === OK;
      }
      /** 自定义逻辑鉴权状态。 */
      override get status() {
        reads();
        return UNAUTHORIZED;
      }
    }
    const factory = axpResponse<Custom>({
      create: /** 用自定义子类构造响应。 */ (init) => new Custom(init),
    });
    const ctx = testContext();
    for (const kind of ["network", "timeout", "cancel", "parse", "auth", "internal"] as const) {
      const response = factory.fail({ kind }, ctx);
      expect([response.ok, response.status, response.kind]).toEqual([false, 0, kind]);
    }
    expect(reads).not.toHaveBeenCalled();
    const response = factory.fromResponse(raw({ code: OK, data: 1 }), ctx);
    expect([response.ok, response.kind, response.status]).toEqual([true, "ok", UNAUTHORIZED]);
    expect(reads).toHaveBeenCalled();
  });
  it("[core.cb.create][core.fn.isAxpResponse][core.const.AXP_RESPONSE] 普通对象补不可枚举品牌，跨副本品牌有效", /** 普通对象补不可枚举品牌，跨副本品牌有效。 */ () => {
    const factory = axpResponse({
      create: /** 保留完整响应字段并移除类原型。 */ (init) => {
        const response = new AxpResponse(init);
        return {
          ...response,
          ok: response.ok,
          status: response.status,
          kind: response.kind,
        } as AxpResponse;
      },
    });
    const response = factory.fail({ kind: "auth" }, testContext());
    expect(isAxpResponse(response)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(response, AXP_RESPONSE)?.enumerable).toBe(false);
    expect(isAxpResponse({ [Symbol.for("axp.response")]: true })).toBe(true);
    for (const value of [new Error(), {}, null, undefined, 1, "response"])
      expect(isAxpResponse(value)).toBe(false);
  });
  it("[core.method.toJSON][core.method.fail] 派生字段完整且不改原响应", /** 派生字段完整且不改原响应。 */ () => {
    const factory = axpResponse();
    const original = factory.fromResponse(
      raw({ code: UNAUTHORIZED, data: 1, message: "denied" }),
      testContext(),
    );
    const derived = factory.fail(
      { from: original, stack: "callsite", reason: "expired", data: undefined },
      testContext(),
    );
    expect(derived).not.toBe(original);
    expect(original.stack).toBeUndefined();
    expect(derived.toJSON()).toMatchObject({
      ok: false,
      status: UNAUTHORIZED,
      kind: "biz",
      httpStatus: OK,
      code: UNAUTHORIZED,
      message: "denied",
      data: undefined,
      reason: "expired",
      stack: "callsite",
      request: { method: original.request.method, url: original.request.url },
    });
    expect(derived.toJSON()).not.toHaveProperty("raw");
    expect(derived.toJSON()).not.toHaveProperty("error");
    expect(JSON.parse(JSON.stringify(new AxpResponse({ httpStatus: OK })))).toMatchObject({
      ok: true,
      kind: "ok",
      status: OK,
    });
    const failure = factory.fail(
      { kind: "cancel", message: "stop", error: "reason" },
      testContext(),
    );
    expect(factory.fail({ from: failure }, testContext())).toMatchObject({
      kind: "cancel",
      error: "reason",
      message: "stop",
    });
    // 显式 error 覆盖来源，包括用 undefined 清除；未写 error 键时沿用来源。
    expect(factory.fail({ from: failure, error: undefined }, testContext()).error).toBeUndefined();
    expect(factory.fail({ from: failure, error: "other" }, testContext()).error).toBe("other");
    expect(new AxpResponse({ from: original }).data).toBe(1);
  });
});
it("[core.opt.expectJson] 关闭守卫不读取响应头，缺失响应头不误判解析失败", /** 验证头读取边界。 */ () => {
  const ctx = testContext();
  const missing = { ...raw("text"), headers: undefined } as unknown as AxiosResponse;
  expect(axpResponse().fromResponse(missing, ctx).kind).toBe("ok");
  expect(axpResponse({ expectJson: true }).fromResponse(missing, ctx).kind).toBe("ok");
  const unreadable = {
    ...raw("text"),
    /** 关闭 expectJson 时不能触碰此 getter。 */
    get headers(): AxiosResponse["headers"] {
      throw new Error("headers read");
    },
  };
  expect(axpResponse().fromResponse(unreadable, ctx).data).toBe("text");
});
