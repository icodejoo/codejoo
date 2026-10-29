import { AXP_FAILURE } from "../../src/response";
import { expect, it, vi } from "vitest";
import { settle } from "../../src/client";
import { axpResponse } from "../../src/response";
import { testContext } from "../helpers/context";

/** 三种返回模式。 */
const MODES = [{}, { wrap: true }, { throws: false }];
/** 失败业务码。 */
const BIZ_FAILURE = 401;
/** 固定的调用点栈文本。 */
const CALLSITE_STACK = "callsite";
/** 带固定栈文本的调用点，不依赖真实栈内容。 */
const CALLSITE = Object.assign(new Error("callsite"), { stack: CALLSITE_STACK });

it.each(MODES)(
  "[core.fn.settle] 成功九格：%j",
  /** 成功响应在九种 wrap/throws 组合下的返回形态。 */ (mode) => {
    const ctx = testContext(mode);
    const response = ctx.fail({ status: 200, data: "data" });
    expect(settle(response, ctx, {})).toBe(mode.wrap || mode.throws === false ? response : "data");
  },
);
it.each(MODES)(
  "[core.fn.settle] 可预期失败九格：%j",
  /** 可预期失败在九种 wrap/throws 组合下的抛出或返回。 */ (mode) => {
    const ctx = testContext(mode);
    const response = ctx.fail({ status: 200, code: BIZ_FAILURE });
    if (mode.throws === false) expect(settle(response, ctx, {})).toBe(response);
    else expect(/** 可预期失败在 throws 开启时被抛出。 */ () => settle(response, ctx, {})).toThrow(response);
  },
);
it.each(MODES)(
  "[core.fn.settle] bug 九格始终抛原异常：%j",
  /** internal 失败在九种 wrap/throws 组合下都抛出原始异常。 */ (mode) => {
    const ctx = testContext(mode);
    const bug = new TypeError("bug");
    expect(/** internal 响应抛出原始异常。 */ () => settle(ctx.fail({ failure: "internal", error: bug }), ctx, {})).toThrow(bug);
  },
);
it("[core.cb.reject][core.req.throws] reject 只处理请求级 throws 开启的可预期失败", /** reject 只处理请求级 throws 开启的可预期失败。 */ () => {
  const ctx = testContext();
  const response = ctx.fail({ failure: "network" });
  const converted = new Error("converted");
  const reject = vi.fn(/** 把失败响应转换为自定义错误。 */ () => converted);
  expect(settle(response, testContext({ throws: false }), { reject })).toBe(response);
  expect(/** reject 转换后的错误被抛出。 */ () => settle(response, ctx, { reject })).toThrow(converted);
  const explicit = testContext({ throws: true });
  expect(/** 请求级 throws:true 优先，仍抛原响应。 */ () => settle(response, explicit, {})).toThrow(response);
  const bug = new TypeError("reject bug");
  expect(
    /** reject 自身抛错时原样透传。 */ () =>
      settle(response, ctx, {
        reject: /** 模拟 reject 转换器内部程序异常。 */ () => {
          throw bug;
        },
      }),
  ).toThrow(bug);
  expect(reject).toHaveBeenCalledExactlyOnceWith(response);
});
it("[core.opt.debug][core.cb.reject] 调用点派生工厂抛错时跳过 reject 并抛原异常", /** 验证派生失败落定。 */ () => {
  const bug = new TypeError("debug derivation");
  const base = testContext();
  const original = base.fail({ failure: "network" });
  const ctx = testContext(
    {},
    {
      ...axpResponse(),
      /** 模拟派生构造失败。 */
      fail() {
        throw bug;
      },
    },
  );
  const reject = vi.fn();
  expect(/** 执行失败派生。 */ () => settle(original, ctx, { reject }, CALLSITE)).toThrow(bug);
  expect(reject).not.toHaveBeenCalled();
  expect(original.stack).toBeUndefined();
});
it("[core.opt.debug] debug 失败派生副本，共享原对象不变", /** debug 失败派生副本，共享原对象不变。 */ () => {
  const ctx = testContext();
  const original = ctx.fail({ failure: "timeout", data: "shared" });
  try {
    settle(original, ctx, {}, CALLSITE);
  } catch (derived) {
    expect(derived).not.toBe(original);
    expect(derived).toMatchObject({ stack: CALLSITE_STACK, data: "shared", [AXP_FAILURE]: { type: "timeout" } });
  }
  expect(original.stack).toBeUndefined();
});
