import { expect, it, vi } from "vitest";
import axpCache from "../../src/plugins/cache";
import { createTestClient } from "../helpers/client";
import { asyncCacheStore, countingCacheStore } from "../helpers/source";

/** 缓存调试接口。 */
const URL = "/cache-debug";

it.each([false, true])(
  "[cache.opt.clone][core.opt.debug] 调用方修改共享数据只在 debug 下警告一次 debug=%s",
  /** 默认内存仓保留条目身份。 */ async (debug) => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, net } = createTestClient([axpCache()], { debug: debug ? log : false });
    net.fallback(/** 返回可共享对象。 */ () => ({ data: { code: 0, data: { n: 0 } } }));
    const data = await api.get(URL)<{ n: number }>(undefined, { cache: true });
    await api.get(URL)(undefined, { cache: true });
    data.n++;
    expect(await api.get(URL)(undefined, { cache: true })).toBe(data);
    data.n++;
    await api.get(URL)(undefined, { cache: true });
    expect(net.totalStarted).toBe(1);
    expect(log.warn).toHaveBeenCalledTimes(debug ? 1 : 0);
    if (debug) expect(log.warn).toHaveBeenCalledWith("[axp:cache] 调用方已原地修改缓存数据，命中将返回修改值；请开 clone 或先拷贝");
    api.dispose();
  },
);

it.each(["clone", "identity", "unhashable"] as const)(
  "[core.opt.debug][cache.opt.store] %s 不产生缓存修改告警",
  /** 拷贝隔离、不同条目身份或不可哈希均跳过。 */ async (mode) => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { store } = asyncCacheStore();
    const { api, net } = createTestClient([axpCache({ clone: mode === "clone" ? "deep" : undefined, store: mode === "identity" ? store : undefined })], { debug: log });
    net.fallback(/** 不可哈希值保留函数字段。 */ () => ({ data: { code: 0, data: mode === "unhashable" ? { n: 0, fn: /** 阻止哈希。 */ () => 1 } : { n: 0 } } }));
    const data = await api.get(URL)<{ n: number }>(undefined, { cache: true });
    data.n++;
    const hit = await api.get(URL)<{ n: number }>(undefined, { cache: true });
    expect(hit.n).toBe(mode === "unhashable" ? 1 : 0);
    expect(log.warn).not.toHaveBeenCalled();
    expect(net.totalStarted).toBe(1);
    api.dispose();
  },
);

it("[cache.opt.store][core.req.signal] 同步 get 内取消后命中仍返回 cancel", /** 防止自定义同步仓读取期间触发的取消被缓存命中掩盖。 */ async () => {
  const controller = new AbortController();
  const { store } = countingCacheStore();
  const { api, net } = createTestClient([
    axpCache({
      store: {
        ...store,
        /** 返回命中前同步取消。 */ get() {
          controller.abort();
          return { snapshot: { status: 200, data: 1 }, expiresAt: Infinity };
        },
      },
    }),
  ]);
  const response = await api.get(URL)(undefined, { cache: true, signal: controller.signal, throws: false });
  expect(api.isCancel(response)).toBe(true);
  expect(net.totalStarted).toBe(0);
  api.dispose();
});
