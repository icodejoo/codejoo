import { AxiosError } from "axios";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AXP_FAILURE, AxpResponse, axpResponse, failureOf, isAxpCancel, type IAxpResponse, type IAxpResponseFactory } from "../../src/response";
import { createTestClient } from "../helpers/client";

/** 原始响应场景也仅推进假网络时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 不把假时钟泄漏给其它文件。 */
afterEach(() => {
  vi.useRealTimers();
});

it.each(["create", "factory"] as const)(
  "[core.opt.response][core.req.throws] %s 忽略 error 时 internal 仍抛原始异常",
  /** 可选的使用者诊断字段不能吞掉程序异常。 */ async (mode) => {
    const bug = new TypeError("original transport bug");
    const create = /** 刻意丢弃初始化字段和原始异常。 */ () => ({ ok: true, status: 0, code: 0, data: null, error: "wrong" });
    const response: IAxpResponseFactory<IAxpResponse> = mode === "factory" ? { fromResponse: create, fromError: create, fail: create } : axpResponse<IAxpResponse>({ create });
    const h = createTestClient<IAxpResponse>(
      [],
      { response },
      /** 模拟拦截器程序异常。 */ async () => {
        throw bug;
      },
    );
    await expect(h.api.request({ throws: false })).rejects.toBe(bug);
    h.api.dispose();
  },
);

it.each(["object", "getter", "factory"] as const)(
  "[core.cb.create][core.fn.failureOf] 网络分类和 ok 由内核强制，使用者误判方式=%s",
  /** 每条构造路径均不能把传输失败变成成功。 */ async (mode) => {
    /** 故意对所有输入都判成功。 */
    class Wrong extends AxpResponse {
      /** 错误的成功判定。 */ override get ok() {
        return true;
      }
    }
    const create = /** 接口实现刻意不处理传输异常。 */ () => ({ ok: true, status: 0, code: 0, data: null });
    const response: IAxpResponseFactory<IAxpResponse> =
      mode === "factory" ? { fromResponse: create, fromError: create, fail: create } : axpResponse<IAxpResponse>({ create: mode === "object" ? create : /** 使用错误 getter。 */ (init) => new Wrong(init) });
    const h = createTestClient<IAxpResponse>(
      [],
      { response },
      /** 模拟真实传输层捕获 AxiosError。 */ async () => {
        throw new AxiosError("offline", "ERR_NETWORK");
      },
    );
    const failed = await h.api.request({ throws: false });
    expect(failed.ok).toBe(false);
    expect(failureOf(failed)).toEqual({ type: "network", reason: undefined });
    expect(Object.hasOwn(failed, "ok")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(failed, AXP_FAILURE)?.enumerable).toBe(false);
    h.api.dispose();
  },
);

it("[core.fn.failureOf][core.fn.isAxpCancel][core.method.isCancel] 取消识别只读内核事实，HTTP 和业务失败无标记", /** 无信号发送、取消和普通收到响应的读法一致。 */ async () => {
  const h = createTestClient();
  const controller = new AbortController();
  controller.abort();
  const cancelled = await h.api.request({ signal: controller.signal, throws: false });
  expect(failureOf(cancelled)?.type).toBe("cancel");
  expect(isAxpCancel(cancelled)).toBe(true);
  expect(h.api.isCancel(cancelled)).toBe(true);
  for (const status of [200, 500]) {
    h.net.fallback(/** 返回 HTTP 或业务失败。 */ () => ({ status, data: { code: 401, data: null } }));
    const pending = h.api.request({ throws: false });
    await vi.runAllTimersAsync();
    const received = await pending;
    expect(received.ok).toBe(false);
    expect(failureOf(received)).toBeUndefined();
    expect(h.api.isCancel(received)).toBe(false);
  }
  expect(h.api.isCancel(new AxiosError("cancel", "ERR_CANCELED"))).toBe(false);
  h.api.dispose();
});
