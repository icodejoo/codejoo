import { expect, it } from "vitest";
import { createFreshnessBarrier, createMemoryStore } from "../../src/plugins/cache-store";
import type { IAxpCacheEntry } from "../../src/plugins/cache-store";

/** 构造永不过期条目。 */
function entry(response: string): IAxpCacheEntry<string> {
  return { response, expiresAt: Infinity };
}
/** 共享测试键。 */
const KEY = "key";
/** 共享响应。 */
const VALUE = "value";

it("[cache.fn.createMemoryStore] 同步存取共享引用，支持删除、清空和仓隔离", () => {
  const store = createMemoryStore<string>();
  const other = createMemoryStore<string>();
  const cached = entry(VALUE);
  expect(store.size).toBe(0);
  expect(store.get(KEY)).toBeUndefined();
  store.set(KEY, cached);
  expect(store.size).toBe(1);
  expect(store.get(KEY)).toBe(cached);
  expect(other.get(KEY)).toBeUndefined();
  expect(store.delete(KEY)).toBe(true);
  expect(store.delete(KEY)).toBe(false);
  store.set(KEY, cached);
  store.clear();
  store.clear();
  expect(store.size).toBe(0);
});

it("[cache.fn.createMemoryStore] 默认容量为 500，超出淘汰最旧条目", () => {
  const store = createMemoryStore<string>();
  const capacity = 500;
  for (let index = 0; index <= capacity; index++) store.set(String(index), entry(VALUE));
  expect(store.size).toBe(capacity);
  expect(store.get("0")).toBeUndefined();
  expect(store.get(String(capacity))?.response).toBe(VALUE);
});

it("[cache.fn.createFreshnessBarrier] 独立屏障分配全局递增票据并登记写入下界", () => {
  const barrier = createFreshnessBarrier();
  const other = createFreshnessBarrier();
  const first = barrier.begin(KEY);
  const second = barrier.begin("other");
  expect(second).toBe(first + 1);
  expect(other.begin(KEY)).toBe(first);
  expect(barrier.canWrite(KEY, first)).toBe(true);
  barrier.markWritten(KEY, first);
  expect(barrier.canWrite(KEY, first)).toBe(false);
  // 该键仍有在途请求时记录保留，下界不丢
  barrier.begin(KEY);
  barrier.end(KEY);
  expect(barrier.canWrite(KEY, first)).toBe(false);
  // 在途归零即回收记录，之后发起的票据序号必然更大，无需下界
  barrier.end(KEY);
  expect(barrier.canWrite(KEY, first)).toBe(true);
});
