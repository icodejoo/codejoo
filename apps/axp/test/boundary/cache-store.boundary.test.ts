import { expect, it, vi } from "vitest";
import { createFreshnessBarrier, createMemoryStore } from "../../src/plugins/cache-store";

/** 三条记录测试中的第三个键。 */
const THIRD_KEY = "third";
/** 替换响应。 */
const REPLACEMENT = "replacement";
/** LRU 测试容量。 */
const SMALL_CAPACITY = 2;
/** 主测试键。 */
const KEY = "key";
/** 另一个键。 */
const OTHER_KEY = "other";
/** 测试当前时间。 */
const NOW = 100;
/** 测试响应。 */
const RESPONSE = "response";
/** 默认容量。 */
const CAPACITY = 500;

it.each([0, -1, NaN])("[cache.fn.createMemoryStore] max=%s 回退 500", (max) => {
  const store = createMemoryStore<string>({ max });
  for (let index = 0; index <= CAPACITY; index++) {
    store.set(String(index), { response: RESPONSE, expiresAt: Infinity });
  }
  expect(store.size).toBe(CAPACITY);
  expect(store.get("0")).toBeUndefined();
});

it("[cache.fn.createMemoryStore] Infinity 不限容量且未溢出不调用时钟", () => {
  const now = vi.fn(() => NOW);
  const store = createMemoryStore<string>({ max: Infinity, now });
  for (let index = 0; index <= CAPACITY; index++) {
    store.set(String(index), { response: RESPONSE, expiresAt: NOW });
  }
  expect(store.size).toBe(CAPACITY + 1);
  expect(now).not.toHaveBeenCalled();
});

it("[cache.fn.createMemoryStore] get 命中和 set 替换都提升 LRU 顺序", () => {
  const store = createMemoryStore<string>({ max: SMALL_CAPACITY });
  const entry = { response: RESPONSE, expiresAt: Infinity };
  store.set(KEY, entry);
  store.set(OTHER_KEY, entry);
  store.get(KEY);
  store.set(THIRD_KEY, entry);
  expect(store.get(OTHER_KEY)).toBeUndefined();
  store.set(KEY, { ...entry, response: REPLACEMENT });
  store.set(OTHER_KEY, entry);
  expect(store.get(THIRD_KEY)).toBeUndefined();
  expect(store.get(KEY)?.response).toBe(REPLACEMENT);
  expect(store.size).toBe(SMALL_CAPACITY);
});

it.each([NOW - 1, NOW, NaN])("[cache.fn.createMemoryStore] 到期/负 TTL/NaN expiresAt=%s 读取即删除", (expiresAt) => {
  const store = createMemoryStore<string>({ now: () => NOW });
  store.set(KEY, { response: RESPONSE, expiresAt });
  expect(store.size).toBe(1);
  expect(store.get(KEY)).toBeUndefined();
  expect(store.size).toBe(0);
});

it("[cache.fn.createMemoryStore] 到期前 1ms 有效，恰好到期失效", () => {
  let timestamp = NOW;
  const store = createMemoryStore<string>({ now: () => timestamp });
  store.set(KEY, { response: RESPONSE, expiresAt: NOW + 1 });
  expect(store.get(KEY)?.response).toBe(RESPONSE);
  timestamp++;
  expect(store.get(KEY)).toBeUndefined();
});

it("[cache.fn.createMemoryStore] 溢出时清扫过期项后再按需淘汰，未溢出保留过期项", () => {
  const now = vi.fn(() => NOW);
  const store = createMemoryStore<string>({ max: SMALL_CAPACITY, now });
  const live = { response: RESPONSE, expiresAt: Infinity };
  store.set(KEY, live);
  store.set(OTHER_KEY, { response: RESPONSE, expiresAt: NOW });
  expect(now).not.toHaveBeenCalled();
  expect(store.size).toBe(SMALL_CAPACITY);
  store.set(THIRD_KEY, live);
  expect(now).toHaveBeenCalledTimes(1);
  expect(store.size).toBe(SMALL_CAPACITY);
  expect(store.get(KEY)).toBe(live);
  expect(store.get(OTHER_KEY)).toBeUndefined();
});

it("[cache.fn.createMemoryStore] 满载时清扫按容量节流：窗口内的溢出写入不读时钟，只淘汰最久未用", () => {
  const now = vi.fn(() => NOW);
  const store = createMemoryStore<string>({ max: SMALL_CAPACITY, now });
  const live = { response: RESPONSE, expiresAt: Infinity };
  store.set(KEY, live);
  store.set(OTHER_KEY, live);
  // 首次溢出：清扫一次，再淘汰最旧的 KEY
  store.set(THIRD_KEY, live);
  expect(now).toHaveBeenCalledTimes(1);
  // 窗口内的溢出：不清扫，直接按 LRU 淘汰 OTHER_KEY
  store.set(KEY, { response: RESPONSE, expiresAt: NOW });
  expect(now).toHaveBeenCalledTimes(1);
  // 溢出次数攒满容量值：再清扫一次，过期的 KEY 被扫掉，THIRD_KEY 保住
  store.set(OTHER_KEY, live);
  expect(now).toHaveBeenCalledTimes(2);
  expect(store.size).toBe(SMALL_CAPACITY);
  expect(store.get(THIRD_KEY)).toBe(live);
  expect(store.get(KEY)).toBeUndefined();
});

it("[cache.fn.createFreshnessBarrier] R2-2：新响应写入后被 LRU 淘汰，仍拒绝较早发起的响应", () => {
  const barrier = createFreshnessBarrier();
  const store = createMemoryStore<string>({ max: 1 });
  const old = barrier.begin(KEY);
  const fresh = barrier.begin(KEY);
  expect(barrier.canWrite(KEY, fresh)).toBe(true);
  store.set(KEY, { response: "fresh", expiresAt: Infinity });
  barrier.markWritten(KEY, fresh);
  barrier.end(KEY);
  store.set(OTHER_KEY, { response: RESPONSE, expiresAt: Infinity });
  barrier.reclaim(KEY, store.get(KEY) !== undefined);
  expect(barrier.canWrite(KEY, old)).toBe(false);
  barrier.markWritten(KEY, old);
  expect(barrier.canWrite(KEY, fresh)).toBe(false);
  barrier.end(KEY);
  barrier.reclaim(KEY, false);
  expect(barrier.canWrite(KEY, fresh)).toBe(true);
});

it("[cache.fn.createFreshnessBarrier] 老请求先返回可写，新请求随后覆盖，失败未登记不阻挡旧响应", () => {
  const barrier = createFreshnessBarrier();
  const old = barrier.begin(KEY);
  const fresh = barrier.begin(KEY);
  barrier.markWritten(KEY, old);
  expect(barrier.canWrite(KEY, fresh)).toBe(true);
  barrier.markWritten(KEY, fresh);
  expect(barrier.canWrite(KEY, old)).toBe(false);
  const first = barrier.begin(OTHER_KEY);
  barrier.begin(OTHER_KEY);
  barrier.end(OTHER_KEY);
  expect(barrier.canWrite(OTHER_KEY, first)).toBe(true);
});

it("[cache.fn.createFreshnessBarrier] clear 使旧票据失效，旧请求结束不回收新代次仍在途的记录", () => {
  const barrier = createFreshnessBarrier();
  const old = barrier.begin(KEY);
  barrier.clear();
  barrier.clear();
  const fresh = barrier.begin(KEY);
  expect(fresh.epoch).toBe(old.epoch + 2);
  expect(fresh.seq).toBeGreaterThan(old.seq);
  expect(barrier.canWrite(KEY, old)).toBe(false);
  barrier.markWritten(KEY, old);
  expect(barrier.canWrite(KEY, fresh)).toBe(true);
  barrier.markWritten(KEY, fresh);
  barrier.end(KEY);
  barrier.reclaim(KEY, false);
  expect(barrier.canWrite(KEY, fresh)).toBe(false);
  barrier.end(KEY);
  barrier.end(KEY);
  barrier.reclaim(KEY, false);
  expect(barrier.canWrite(KEY, fresh)).toBe(true);
  expect(barrier.canWrite(KEY, old)).toBe(false);
  barrier.markWritten(KEY, fresh);
  barrier.end(KEY);
  barrier.reclaim(KEY, false);
});
