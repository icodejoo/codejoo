import { AXP_FAILURE } from "../../src/response";
import { runInNewContext } from "node:vm";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthFailureAction } from "../../src/plugins/auth";
import type { AxpRequestPatch } from "../../src/types";
import { authClient, deferred, failure, REQUEST_URL, run } from "../helpers/b3";

/** 判定与准备回调的原始异常。 */
const BUG = new Error("auth callback bug");
/** 另一执行环境的 Promise，不满足本 realm 的 instanceof Promise。 */
const ForeignPromise: PromiseConstructor = runInNewContext("Promise");

/** 所有异步边界使用可控假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it.each(["ready", "onFailure"] as const)(
  "[auth.cb.ready][auth.cb.onFailure][core.req.signal] %s 挂起时取消立即落定，pending 和 signal 监听归零，迟到成功不产生副作用",
  /** 回调未落定时就完成调用方取消。 */ async (name) => {
    const readyGate = deferred<AxpRequestPatch>();
    const routeGate = deferred<AuthFailureAction>();
    const callback = vi.fn(/** 对应回调保持挂起。 */ () => (name === "ready" ? readyGate.promise : routeGate.promise));
    const h = authClient({ [name]: callback });
    h.net.on("get", REQUEST_URL, /** onFailure 场景先得到失败。 */ () => failure(403));
    const controller = new AbortController();
    const pending = h.send({ url: REQUEST_URL, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(h.api.pending()).toBe(1);
    expect(h.events.listeners).toBeGreaterThan(0);
    const sends = h.net.totalStarted;
    controller.abort();
    expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    expect(h.api.pending()).toBe(0);
    expect(h.events.listeners).toBe(0);
    readyGate.resolve({ headers: { Authorization: "late" } });
    routeGate.resolve(AuthFailureAction.Expired);
    await vi.runAllTimersAsync();
    expect(h.net.totalStarted).toBe(sends);
    expect(h.settings.onRefresh).not.toHaveBeenCalled();
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
  },
);

it.each(["ready", "onFailure"] as const)(
  "[auth.cb.ready][auth.cb.onFailure][core.req.signal] %s 取消后才拒绝，不产生未处理 rejection 或通知",
  /** 放弃的回调保留拒绝处理器。 */ async (name) => {
    const gate = deferred<void>();
    const h = authClient({
      [name]: /** 取消落定后再抛出回调异常。 */ async () => {
        await gate.promise;
        throw BUG;
      },
    });
    h.net.on("get", REQUEST_URL, /** 进入路由回调。 */ () => failure(401));
    const controller = new AbortController();
    const pending = h.send({ url: REQUEST_URL, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    gate.resolve();
    // Vitest 自身也会把未处理拒绝记为本轮错误。
    await vi.runAllTimersAsync();
    expect(h.api.pending()).toBe(0);
    expect(h.events.listeners).toBe(0);
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
    expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
  },
);

it("[auth.cb.ready] ready 同步抛错仍将原始异常交给调用方", /** 同步调用发生在可取消等待之前。 */ async () => {
  const h = authClient({
    ready: /** 同步程序故障。 */ () => {
      throw BUG;
    },
  });
  await expect(run(h)).rejects.toBe(BUG);
  expect(h.api.pending()).toBe(0);
  expect(h.net.totalStarted).toBe(0);
});

it("[auth.cb.ready][core.req.signal] ready 同步取消并返回补丁，不调用内层 next", /** 同步快路径也重查取消。 */ async () => {
  const controller = new AbortController();
  const h = authClient({
    ready: /** 准备凭证时取消。 */ () => {
      controller.abort();
      return {};
    },
  });
  expect(await run(h, { signal: controller.signal })).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
  expect(h.net.totalStarted).toBe(0);
});

it("[auth.req.protected][core.req.signal] POST 已返回成功响应后取消，保留真实响应且不重放", /** 迟到取消不能覆盖已完成的写入结果。 */ async () => {
  const controller = new AbortController();
  const onFailure = vi.fn();
  const h = authClient({ onFailure });
  let received;
  h.api.use({
    name: "abort-after-response",
    stage: "source",
    /** 收到真实响应后取消，再把同一响应交回 auth。 */ async handle(_ctx, next) {
      received = await next();
      controller.abort();
      return received;
    },
  });
  h.net.on("post", REQUEST_URL, /** 模拟已完成的写入。 */ () => ({ data: { code: 0, data: "created" } }));
  const response = await run(h, { method: "post", signal: controller.signal });
  expect(response).toBe(received);
  expect(response).toMatchObject({ ok: true, data: "created" });
  expect(h.net.totalStarted).toBe(1);
  expect(h.api.pending()).toBe(0);
  expect(h.events.listeners).toBe(0);
  expect(onFailure).not.toHaveBeenCalled();
  expect(h.settings.onRefresh).not.toHaveBeenCalled();
  expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
  expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
});

it("[auth.cb.ready][core.req.signal] ready 取消且 token 变化时不再重做凭证", /** 被取消的异步准备不继续追赶 token。 */ async () => {
  const gate = deferred<AxpRequestPatch>();
  const ready = vi.fn(/** 挂起准备。 */ () => gate.promise);
  const h = authClient({ ready });
  const controller = new AbortController();
  const pending = h.send({ url: REQUEST_URL, signal: controller.signal });
  await vi.advanceTimersByTimeAsync(0);
  h.tm.clear();
  controller.abort();
  expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
  gate.resolve({});
  await vi.runAllTimersAsync();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(h.settings.onAccessDenied).not.toHaveBeenCalled();
});

it.each([true, false])(
  "[auth.cb.isProtected][core.req.signal] isProtected 判定时取消，protected=%s 以 cancel 落定且不进入凭证或来源层",
  /** 公开和受保护入口均检查取消。 */ async (protectedRequest) => {
    const controller = new AbortController();
    const ready = vi.fn();
    const h = authClient({
      ready,
      isProtected: /** 保护判定中发生取消。 */ () => {
        controller.abort();
        return protectedRequest;
      },
    });
    expect(await run(h, { signal: controller.signal })).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    expect(ready).not.toHaveBeenCalled();
    expect(h.net.totalStarted).toBe(0);
  },
);

it.each(["ready", "onFailure"] as const)(
  "[auth.cb.ready][auth.cb.onFailure][core.req.signal] %s 同步取消后返回拒绝 Promise，以 cancel 落定且拒绝已处理",
  /** waitAbortable 的已取消快路径也不会遗留未观察承诺。 */ async (name) => {
    const controller = new AbortController();
    const h = authClient({
      [name]: /** 先取消再交出拒绝承诺。 */ () => {
        controller.abort();
        return Promise.reject(BUG);
      },
    });
    h.net.on("get", REQUEST_URL, /** 进入 onFailure。 */ () => failure(401));
    expect(await run(h, { signal: controller.signal })).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    expect(h.api.pending()).toBe(0);
    expect(h.events.listeners).toBe(0);
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
  },
);

it.each(["ready", "onFailure"] as const)(
  "[auth.cb.ready][auth.cb.onFailure][core.req.signal] %s 返回跨 realm Promise，仍等待回调并可被取消",
  /** 同步快路径不依赖 Promise 构造器身份。 */ async (name) => {
    const gate = deferred<void>();
    const callback = vi.fn(/** 返回其他执行环境创建的承诺。 */ () => ForeignPromise.resolve(gate.promise));
    const h = authClient({ [name]: callback });
    h.net.on("get", REQUEST_URL, /** 进入 onFailure。 */ () => failure(401));
    const controller = new AbortController();
    const pending = h.send({ url: REQUEST_URL, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(h.api.pending()).toBe(1);
    controller.abort();
    expect(await pending).toMatchObject({ [AXP_FAILURE]: { type: "cancel" } });
    expect(h.events.listeners).toBe(0);
    gate.resolve();
    await vi.runAllTimersAsync();
    expect(h.settings.onAccessExpired).not.toHaveBeenCalled();
  },
);
