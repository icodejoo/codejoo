/* eslint-disable no-await-in-loop -- 按时间边界顺序观测重试轮次。 */
import { AxiosError } from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import axpRetry, { type IRetryOptions } from "../../src/plugins/retry";
import type { AxpResponse } from "../../src/response";
import type { AxpRequestOptions, AxpRequestConfig } from "../../src/types";
import { b3Client, REQUEST_URL, RETRY_NAME } from "../helpers/b3";

/** 每个重试用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

it("[retry.opt.max][retry.opt.delay][retry.prop.name] 默认两次重试，退避为 300/600 毫秒", /** 默认预算与时序。 */ async () => {
  const plugin = axpRetry<AxpResponse>();
  const h = b3Client([plugin]);
  h.net.fallback(/** 最终一次恢复。 */ (_config, hit) => ({ status: hit < 3 ? 500 : 200 }));
  const pending = h.send({ url: REQUEST_URL });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.net.totalStarted).toBe(1);
  await vi.advanceTimersByTimeAsync(299);
  expect(h.net.totalStarted).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.net.totalStarted).toBe(2);
  await vi.advanceTimersByTimeAsync(599);
  expect(h.net.totalStarted).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  await vi.runAllTimersAsync();
  expect((await pending).ok).toBe(true);
  expect(h.net.totalStarted).toBe(3);
  expect(plugin.name).toBe(RETRY_NAME);
  expect(h.api.inspect()).toContainEqual({ name: RETRY_NAME, stage: "attempt" });
});

it.each([
  [undefined, 3],
  [null, 3],
  [true, 3],
  [{}, 3],
  [false, 1],
  [{ enable: false, max: 8 }, 1],
  [0, 1],
  [-1, 1],
  [1, 2],
  [{ max: 1 }, 2],
  [{ max: 0 }, 1],
  [{ max: null, delay: null }, 3],
  ["invalid", 3],
  [[], 3],
])(
  "[retry.req.retry][retry.req.retry.max][retry.req.retry.enable] 请求选项 %j 共发送 %i 次",
  /** 四种写法和空值回退。 */ async (retry, count) => {
    const h = b3Client([axpRetry({ delay: 0 })]);
    h.net.fallback(/** 保持可重试失败。 */ () => ({ status: 500 }));
    const request = { url: REQUEST_URL, retry } as AxpRequestConfig;
    const pending = h.send(request);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(h.net.totalStarted).toBe(count);
    expect(result.status).toBe(500);
    expect(request.retry).toBe(retry);
  },
);

it("[retry.req.retry][retry.cb.shouldRetry] 旧请求级函数不执行，运行时沿用插件值", /** 非法值无动态求值。 */ async () => {
  const retry = vi.fn();
  const h = b3Client([axpRetry({ max: 1, delay: 0 })]);
  h.net.fallback(/** 保持失败。 */ () => ({ status: 500 }));
  const pending = h.send({ retry } as unknown as AxpRequestConfig);
  await vi.runAllTimersAsync();
  await pending;
  expect(h.net.totalStarted).toBe(2);
  expect(retry).not.toHaveBeenCalled();
});

it.each([
  ["post", undefined, undefined, 1],
  ["patch", undefined, undefined, 1],
  ["POST", ["POST"], undefined, 2],
  ["get", [], undefined, 1],
  ["get", undefined, { methods: [] }, 1],
  [undefined, undefined, { methods: ["GET"] }, 2],
])(
  "[retry.opt.methods][retry.req.retry.methods] 方法 %s 与白名单硬否决",
  /** 方法关卡先于判定回调。 */ async (method, methods, retry, count) => {
    const shouldRetry = vi.fn(/** 强制重试仍须方法许可。 */ () => true);
    const h = b3Client([axpRetry({ max: 1, delay: 0, methods, shouldRetry })]);
    const pending = h.send({ method, retry } as AxpRequestConfig);
    await vi.runAllTimersAsync();
    await pending;
    expect(h.net.totalStarted).toBe(count);
    expect(shouldRetry).toHaveBeenCalledTimes(count === 1 ? 0 : 1);
  },
);

it.each([408, 429, 500, 502, 503, 504, 400, 404, 501, 200])(
  "[retry.opt.statusCodes] 默认状态 %i，业务状态与 HTTP 状态一致判定",
  /** 分别验证标准与业务错误。 */ async (status) => {
    for (const business of [false, true]) {
      const h = b3Client([axpRetry({ delay: 0, max: 1 })]);
      h.net.fallback(
        /** HTTP 200 信封可承载逻辑错误。 */ () =>
          business
            ? { status: 200, data: { code: status === 200 ? 0 : status, data: null } }
            : { status },
      );
      const pending = h.send();
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.status).toBe(status);
      expect(h.net.totalStarted).toBe([408, 429, 500, 502, 503, 504].includes(status) ? 2 : 1);
    }
  },
);

it.each(["network", "timeout"] as const)(
  "[retry.kind.default][retry.cb.shouldRetry] %s 默认重试，明确 false 可否决",
  /** 没有 HTTP 响应也能恢复。 */ async (kind) => {
    for (const decision of [undefined, false]) {
      const shouldRetry = vi.fn(/** 空值继续默认判断。 */ () => decision);
      const h = b3Client([axpRetry({ delay: 0, max: 1, statusCodes: [], shouldRetry })]);
      h.net.fallback(
        /** 首轮模拟 axios 传输错误。 */ (_config, hit) => {
          if (hit === 1)
            throw new AxiosError(
              kind,
              kind === "network" ? AxiosError.ERR_NETWORK : AxiosError.ECONNABORTED,
            );
          return { status: 200 };
        },
      );
      const pending = h.send();
      await vi.runAllTimersAsync();
      expect((await pending).ok).toBe(decision !== false);
      expect(h.net.totalStarted).toBe(decision === false ? 1 : 2);
      expect(shouldRetry).toHaveBeenCalledTimes(1);
    }
  },
);

it.each([true, false, undefined, null])(
  "[retry.cb.shouldRetry][retry.req.retry.shouldRetry][retry.opt.statusCodes] 判定 %s 优先于状态列表，请求回调覆盖插件",
  /** 判定参数包含逻辑 R、当前重试次数及上下文。 */ async (decision) => {
    const base = vi.fn();
    const shouldRetry = vi.fn(/** 强制成功响应重试，空值回退空状态表。 */ () => decision);
    const h = b3Client([axpRetry({ max: 2, delay: 0, shouldRetry: base, statusCodes: [] })]);
    const pending = h.send({ retry: { shouldRetry } });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(h.net.totalStarted).toBe(decision === true ? 3 : 1);
    expect(shouldRetry.mock.calls.length).toBe(decision === true ? 2 : 1);
    expect(shouldRetry).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      1,
      expect.objectContaining({ request: expect.any(Object) }),
    );
    expect(base).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  },
);

it.each([false, true])(
  "[retry.opt.statusCodes][retry.req.retry.statusCodes] 空状态列表不继承默认值，请求级=%s",
  /** 空数组整体覆盖。 */ async (requestLevel) => {
    const h = b3Client([axpRetry({ delay: 0, statusCodes: requestLevel ? undefined : [] })]);
    h.net.fallback(/** 默认可重试的状态被清空。 */ () => ({ status: 500 }));
    const pending = h.send({ retry: requestLevel ? { statusCodes: [] } : {} });
    await vi.runAllTimersAsync();
    await pending;
    expect(h.net.totalStarted).toBe(1);
  },
);

it("[retry.cb.shouldRetry][retry.opt.max] 后续不可重试失败立即收敛，耗尽返回最后 R", /** 保存真实内层响应身份。 */ async () => {
  const h = b3Client([axpRetry({ max: 4, delay: 0 })]);
  const responses: unknown[] = [];
  h.api.use({
    name: "last-response",
    stage: "source",
    taps: [
      {
        stage: "source",
        /** 保存每次传输原始 R。 */ onResponse(r) {
          responses.push(r);
        },
      },
    ],
  });
  h.net.fallback(
    /** 第一次可重试，第二次硬停止。 */ (_c, hit) => ({ status: hit === 1 ? 500 : 404 }),
  );
  const pending = h.send();
  await vi.runAllTimersAsync();
  expect(await pending).toBe(responses[1]);
  expect(h.net.totalStarted).toBe(2);
});

it.each(["request", "method"] as const)(
  "[retry.priority.veto] %s 关闭后不执行会抛错的判定",
  /** 否决关卡不会进入回调。 */ async (veto) => {
    const shouldRetry = vi.fn(
      /** 不应被执行。 */ () => {
        throw new Error("unexpected decision");
      },
    );
    const h = b3Client([axpRetry({ shouldRetry })]);
    const pending = h.send({
      method: veto === "method" ? "post" : "get",
      retry: veto !== "request",
    });
    await vi.runAllTimersAsync();
    await pending;
    expect(shouldRetry).not.toHaveBeenCalled();
  },
);

it("[retry.method.cleanup][retry.opt.enable] 禁用、卸载、重名拒绝和跨客户端复用", /** 生命周期沿内核约定。 */ async () => {
  const plugin = axpRetry<AxpResponse>({ max: 1, delay: 0 });
  const h = b3Client([plugin]);
  expect(() => h.api.use(plugin)).toThrow("Duplicate plugin");
  expect(h.api.eject(RETRY_NAME)).toBe(true);
  expect(h.api.eject(RETRY_NAME)).toBe(false);
  h.net.fallback(/** 卸载后无重试。 */ () => ({ status: 500 }));
  const pending = h.send();
  await vi.runAllTimersAsync();
  await pending;
  expect(h.net.totalStarted).toBe(1);
  expect(axpRetry({ enable: false }).name).toBe(RETRY_NAME);
  const disabled = b3Client([axpRetry({ enable: false })]);
  expect(disabled.api.inspect().some(/** 禁用插件不可见。 */ (p) => p.name === RETRY_NAME)).toBe(
    false,
  );
  disabled.net.fallback(
    /** 禁用时网络失败同样不重试。 */ () => {
      throw new AxiosError("offline", AxiosError.ERR_NETWORK);
    },
  );
  const noRetry = disabled.send({ retry: { enable: true, max: 3 } });
  await vi.runAllTimersAsync();
  expect((await noRetry).kind).toBe("network");
  expect(disabled.net.totalStarted).toBe(1);
  const another = b3Client([plugin]);
  another.net.fallback(/** 另一客户端正常重试。 */ () => ({ status: 500 }));
  const retry = another.send();
  await vi.runAllTimersAsync();
  await retry;
  expect(another.net.totalStarted).toBe(2);
});

/** 编译期消费选项，防止误把原生 axios 增强带回。 */
export type RetryRequestContract = Pick<AxpRequestOptions, "retry"> & IRetryOptions;
