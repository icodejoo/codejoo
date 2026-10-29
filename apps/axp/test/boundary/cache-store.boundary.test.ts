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
/** 有限有效期条目触发全表清扫的写入次数。 */
const SWEEP_INTERVAL = 64;

it.each([0, -1, NaN])("[cache.fn.createMemoryStore] max=%s 回退 500", (max) => {
  const store = createMemoryStore({ max });
  for (let index = 0; index <= CAPACITY; index++) {
    store.set(String(index), { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: Infinity });
  }
  expect(store.size).toBe(CAPACITY);
  expect(store.get("0")).toBeUndefined();
});

it("[cache.fn.createMemoryStore] Infinity 不限容量，永不过期的条目不触发清扫也不调用时钟", () => {
  const now = vi.fn(() => NOW);
  const store = createMemoryStore({ max: Infinity, now });
  for (let index = 0; index <= CAPACITY; index++) {
    store.set(String(index), { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: Infinity });
  }
  expect(store.size).toBe(CAPACITY + 1);
  expect(now).not.toHaveBeenCalled();
});

it("[cache.fn.createMemoryStore] 容量不限时有限有效期的条目每写入 64 次清扫一次过期项，不会无界增长", () => {
  const now = vi.fn(() => NOW);
  const store = createMemoryStore({ max: Infinity, now });
  const writes = SWEEP_INTERVAL * 3;
  for (let index = 0; index < writes; index++) {
    // 偶数条目已过期，奇数条目仍有效
    store.set(String(index), { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: index % 2 ? NOW + 1 : NOW });
    // 清扫之前不读时钟，过期项按写入累积
    if (index < SWEEP_INTERVAL - 1) expect(now).not.toHaveBeenCalled();
  }
  expect(now).toHaveBeenCalledTimes(3);
  // 每个窗口末尾清扫一次：只留下还有效的条目和窗口内最后一次写入之后的新条目
  expect(store.size).toBe(writes / 2);
  expect(store.get("1")?.snapshot.data).toBe(RESPONSE);
  expect(store.get("0")).toBeUndefined();
});

it("[cache.fn.createMemoryStore] 容量不限且条目都还有效时，清扫间隔随条目数翻倍，插入总代价保持线性", () => {
  const now = vi.fn(() => NOW);
  const store = createMemoryStore({ max: Infinity, now });
  const writes = SWEEP_INTERVAL * 64;
  for (let index = 0; index < writes; index++) store.set(String(index), { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: NOW + 1 });
  expect(store.size).toBe(writes);
  // 固定间隔会清扫 writes / SWEEP_INTERVAL 次、每次全表扫描；按条目数翻倍只需 log2(writes / SWEEP_INTERVAL) + 1 次
  expect(now.mock.calls.length).toBeLessThanOrEqual(Math.log2(writes / SWEEP_INTERVAL) + 1);
});

it("[cache.fn.createMemoryStore] 清扫重置两个节流计数：刚清扫过的窗口内不再重复读时钟", () => {
  const now = vi.fn(() => NOW);
  const store = createMemoryStore({ max: Infinity, now });
  for (let index = 0; index < SWEEP_INTERVAL; index++) store.set(String(index), { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: NOW + 1 });
  expect(now).toHaveBeenCalledTimes(1);
  for (let index = 0; index < SWEEP_INTERVAL - 1; index++) store.set(`next-${index}`, { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: NOW + 1 });
  expect(now).toHaveBeenCalledTimes(1);
});

it("[cache.fn.createMemoryStore] get 命中和 set 替换都提升 LRU 顺序", () => {
  const store = createMemoryStore({ max: SMALL_CAPACITY });
  const entry = { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: Infinity };
  store.set(KEY, entry);
  store.set(OTHER_KEY, entry);
  store.get(KEY);
  store.set(THIRD_KEY, entry);
  expect(store.get(OTHER_KEY)).toBeUndefined();
  store.set(KEY, { ...entry, snapshot: { status: 200, message: "", data: REPLACEMENT } });
  store.set(OTHER_KEY, entry);
  expect(store.get(THIRD_KEY)).toBeUndefined();
  expect(store.get(KEY)?.snapshot.data).toBe(REPLACEMENT);
  expect(store.size).toBe(SMALL_CAPACITY);
});

it.each([NOW - 1, NOW, NaN])("[cache.fn.createMemoryStore] 到期/负 TTL/NaN expiresAt=%s 读取即删除", (expiresAt) => {
  const store = createMemoryStore({ now: () => NOW });
  store.set(KEY, { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt });
  expect(store.size).toBe(1);
  expect(store.get(KEY)).toBeUndefined();
  expect(store.size).toBe(0);
});

it("[cache.fn.createMemoryStore] 到期前 1ms 有效，恰好到期失效", () => {
  let timestamp = NOW;
  const store = createMemoryStore({ now: () => timestamp });
  store.set(KEY, { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: NOW + 1 });
  expect(store.get(KEY)?.snapshot.data).toBe(RESPONSE);
  timestamp++;
  expect(store.get(KEY)).toBeUndefined();
});

it("[cache.fn.createMemoryStore] 溢出时清扫过期项后再按需淘汰，未溢出保留过期项", () => {
  const now = vi.fn(() => NOW);
  const store = createMemoryStore({ max: SMALL_CAPACITY, now });
  const live = { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: Infinity };
  store.set(KEY, live);
  store.set(OTHER_KEY, { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: NOW });
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
  const store = createMemoryStore({ max: SMALL_CAPACITY, now });
  const live = { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: Infinity };
  store.set(KEY, live);
  store.set(OTHER_KEY, live);
  // 首次溢出：清扫一次，再淘汰最旧的 KEY
  store.set(THIRD_KEY, live);
  expect(now).toHaveBeenCalledTimes(1);
  // 窗口内的溢出：不清扫，直接按 LRU 淘汰 OTHER_KEY
  store.set(KEY, { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: NOW });
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
  const store = createMemoryStore({ max: 1 });
  const old = barrier.begin(KEY);
  const fresh = barrier.begin(KEY);
  expect(barrier.canWrite(KEY, fresh)).toBe(true);
  store.set(KEY, { snapshot: { status: 200, message: "", data: "fresh" }, expiresAt: Infinity });
  barrier.markWritten(KEY, fresh);
  barrier.end(KEY);
  // 容量为 1，另一个 key 的写入把 KEY 淘汰出缓存；旧请求仍在途，屏障记录必须保留
  store.set(OTHER_KEY, { snapshot: { status: 200, message: "", data: RESPONSE }, expiresAt: Infinity });
  expect(store.get(KEY)).toBeUndefined();
  expect(barrier.canWrite(KEY, old)).toBe(false);
  barrier.markWritten(KEY, old);
  expect(barrier.canWrite(KEY, fresh)).toBe(false);
  // 全部在途结束，记录回收
  barrier.end(KEY);
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

it("[cache.fn.createFreshnessBarrier] clear 使旧票据失效，旧请求结束不回收新下界之后仍在途的记录", () => {
  const barrier = createFreshnessBarrier();
  const old = barrier.begin(KEY);
  barrier.clear();
  barrier.clear();
  const fresh = barrier.begin(KEY);
  expect(fresh).toBeGreaterThan(old);
  expect(barrier.canWrite(KEY, old)).toBe(false);
  // 作废票据登记写入不抬高新票据的门槛
  barrier.markWritten(KEY, old);
  expect(barrier.canWrite(KEY, fresh)).toBe(true);
  barrier.markWritten(KEY, fresh);
  expect(barrier.canWrite(KEY, fresh)).toBe(false);
  // 旧请求先结束：新请求仍在途，记录保留
  barrier.end(KEY);
  expect(barrier.canWrite(KEY, fresh)).toBe(false);
  // 新请求也结束：在途归零，记录回收；旧票据仍被下界挡住
  barrier.end(KEY);
  expect(barrier.canWrite(KEY, fresh)).toBe(true);
  expect(barrier.canWrite(KEY, old)).toBe(false);
  // 多余的 end 对已回收的键是空操作
  barrier.end(KEY);
});

it("[cache.fn.createFreshnessBarrier] clear 之后新发起的票据可正常写入，作废只针对 clear 当时已发出的票据", () => {
  const barrier = createFreshnessBarrier();
  const before = barrier.begin(KEY);
  barrier.clear();
  const after = barrier.begin(OTHER_KEY);
  expect(barrier.canWrite(KEY, before)).toBe(false);
  expect(barrier.canWrite(OTHER_KEY, after)).toBe(true);
});
