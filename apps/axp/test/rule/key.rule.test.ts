import { expect, it, vi } from "vitest";
import type { AxpResponse } from "../../src/response";
import type { AxpPlugin } from "../../src/types";
import { createTestClient } from "../helpers/client";

/** 测试 URL。 */
const URL = "/key";
it("[core.opt.key][core.method.key] key 惰性计算、每视图缓存与请求配置保留", /** key 惰性计算、每视图缓存与请求配置保留。 */ async () => {
  const scope = vi.fn(/** 固定返回账号分区，并供断言调用次数。 */ () => "account");
  const seen: (string | null)[] = [];
  const reader: AxpPlugin<AxpResponse> = {
    name: "reader",
    /** 同一视图重复取 key，再用补丁派生内层视图。 */ async handle(ctx, next) {
      seen.push(ctx.key(), ctx.key());
      expect(ctx.request.key).toBeUndefined();
      return next({ params: { id: 2 } });
    },
  };
  const inner: AxpPlugin<AxpResponse> = {
    name: "inner",
    /** 内层读取派生视图的 key。 */ async handle(ctx, next) {
      seen.push(ctx.key());
      return next();
    },
  };
  const unused = createTestClient([], { key: { scope } });
  await unused.api.get(URL)({ id: 1 });
  expect(scope).not.toHaveBeenCalled();
  const { api } = createTestClient([reader, inner], { key: { scope } });
  await api.get(URL)({ id: 1 });
  expect(seen[0]).toBe(seen[1]);
  expect(seen[0]).not.toBe(seen[2]);
  expect(scope).toHaveBeenCalledTimes(2);
});
it("[core.req.key] false 禁用且不调用 scope，显式键仍附加 scope", /** false 禁用且不调用 scope，显式键仍附加 scope。 */ async () => {
  const scope = vi.fn(/** 固定返回账号分区。 */ () => "account");
  const results: (string | null)[] = [];
  const plugin: AxpPlugin<AxpResponse> = {
    name: "key-reader",
    /** 记录本层 key，不做补丁。 */ async handle(ctx, next) {
      results.push(ctx.key());
      return next();
    },
  };
  const { api } = createTestClient([plugin], { key: { scope } });
  await api.request({ url: URL, key: false });
  expect(results).toEqual([null]);
  expect(scope).not.toHaveBeenCalled();
  await api.request({ url: URL, key: "explicit" });
  expect(results[1]).toBe("explicit#account");
  expect(scope).toHaveBeenCalledTimes(1);
});
