import { afterEach, expect, it, vi } from "vitest";
import { ABORT_EVENT, hasOwn, isEmptyScalar, isObject, isPlainObject, ORIGIN_PREFIX, toTag, toText, waitAbortable } from "../../src/utils";

/** 自定义类实例，原型既不是 Object.prototype 也不是 null。 */
class Custom {
  /** 实例字段，使其不是空类。 */
  value = 1;
}

it("isObject 把数组和特殊对象也算作对象，排除 null 与原始值", /** 只排除 null、原始值和函数。 */ () => {
  for (const value of [{}, [], new Date(), new Map(), new Custom(), Object.create(null)]) expect(isObject(value)).toBe(true);
  for (const value of [null, undefined, 0, "", "text", true, Symbol("s"), () => {}]) expect(isObject(value)).toBe(false);
});
it("isPlainObject 只接受字面量与无原型字典", /** 数组、日期、类实例等不能当作可按字段复制的纯对象。 */ () => {
  for (const value of [{}, { a: 1 }, Object.create(null), Object.assign(Object.create(null), { a: 1 })]) expect(isPlainObject(value)).toBe(true);
  for (const value of [[], new Date(), new Map(), new Custom(), null, undefined, 1, "text"]) expect(isPlainObject(value)).toBe(false);
});

it("toText 与 String 等价：原始值、数组、自带 toString 的对象和普通对象", /** 对象沿用自身 toString 结果。 */ () => {
  expect(toText("text")).toBe("text");
  expect(toText(1)).toBe("1");
  expect(toText(false)).toBe("false");
  expect(toText(["a", "b"])).toBe("a,b");
  expect(toText({ toString: /** 自定义文本。 */ () => "custom" })).toBe("custom");
  expect(toText({})).toBe("[object Object]");
  expect(toText(null)).toBe("null");
});

/** 每例恢复真实计时器，避免假时钟泄漏到下一例。 */
afterEach(() => vi.useRealTimers());

/** 超时测试使用的等待毫秒数。 */
const WAIT = 50;
/** setTimeout 可接受的最大毫秒数。 */
const MAX_TIMEOUT = 2_147_483_647;
/** 等待结果的固定值。 */
const VALUE = "value";

/** 在信号上挂计数 spy，用来确认监听增删成对。 */
function spySignal(signal: AbortSignal) {
  return { add: vi.spyOn(signal, "addEventListener"), remove: vi.spyOn(signal, "removeEventListener") };
}
/** 手动落定的 promise，便于控制到达时序。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("[core.fn.waitAbortable] 结果先到：返回其值，监听与计时器成对清理", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const { add, remove } = spySignal(controller.signal);
  const pending = deferred<string>();
  const waiting = waitAbortable(pending.promise, controller.signal, WAIT);
  expect(add).toHaveBeenCalledExactlyOnceWith(ABORT_EVENT, expect.any(Function), { once: true });
  expect(vi.getTimerCount()).toBe(1);
  pending.resolve(VALUE);
  expect(await waiting).toBe(VALUE);
  expect(remove).toHaveBeenCalledExactlyOnceWith(ABORT_EVENT, add.mock.calls[0][1]);
  expect(vi.getTimerCount()).toBe(0);
});

it("[core.fn.waitAbortable] 调用时已中止：立即返回 undefined，不挂监听也不起计时器，已有结果也不理会", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  controller.abort();
  const { add, remove } = spySignal(controller.signal);
  expect(await waitAbortable(Promise.resolve(VALUE), controller.signal, WAIT)).toBeUndefined();
  expect(add).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("[core.fn.waitAbortable] 等待中途中止：返回 undefined 并立刻清理；结果之后才到也不再重复解绑", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const { add, remove } = spySignal(controller.signal);
  const pending = deferred<string>();
  const waiting = waitAbortable(pending.promise, controller.signal, WAIT);
  controller.abort();
  expect(vi.getTimerCount()).toBe(0);
  expect(await waiting).toBeUndefined();
  pending.resolve(VALUE);
  await vi.runAllTimersAsync();
  expect(add).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledOnce();
});

it("[core.fn.waitAbortable] 超时：返回 undefined 且信号没有中止，调用方据此区分超时与取消", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const { remove } = spySignal(controller.signal);
  const waiting = waitAbortable(new Promise<string>(() => {}), controller.signal, WAIT);
  await vi.advanceTimersByTimeAsync(WAIT - 1);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await waiting).toBeUndefined();
  expect(controller.signal.aborted).toBe(false);
  expect(remove).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("[core.fn.waitAbortable] 等待对象拒绝：原样拒绝并清理；中止之后才拒绝不产生未处理拒绝", async () => {
  vi.useFakeTimers();
  const failure = new Error("refresh bug");
  const controller = new AbortController();
  const rejected = deferred<string>();
  const waiting = waitAbortable(rejected.promise, controller.signal, WAIT);
  rejected.reject(failure);
  await expect(waiting).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
  const late = deferred<string>();
  const aborted = waitAbortable(late.promise, controller.signal);
  controller.abort();
  expect(await aborted).toBeUndefined();
  late.reject(failure);
  await vi.runAllTimersAsync();
});

it("[core.fn.waitAbortable] 不带信号也不带超时就只等结果；只带超时就是一次可取消的睡眠", async () => {
  vi.useFakeTimers();
  expect(await waitAbortable(Promise.resolve(VALUE))).toBe(VALUE);
  const sleeping = waitAbortable<void>(undefined, undefined, WAIT);
  await vi.advanceTimersByTimeAsync(WAIT);
  expect(await sleeping).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it("[core.fn.waitAbortable] 超过 setTimeout 上限的超时按上限计，不会溢出成立即触发", async () => {
  vi.useFakeTimers();
  const timer = vi.spyOn(globalThis, "setTimeout");
  let done = false;
  const waiting = waitAbortable<void>(undefined, undefined, Infinity).then(() => (done = true));
  expect(timer).toHaveBeenLastCalledWith(expect.any(Function), MAX_TIMEOUT);
  await vi.advanceTimersByTimeAsync(MAX_TIMEOUT - 1);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(done).toBe(true);
});

it("[core.const.ORIGIN_PREFIX] 只命中协议与主机部分，相对地址、查询与片段不命中，可重复使用", () => {
  expect("https://host:8080/a?q=1".match(ORIGIN_PREFIX)?.[0]).toBe("https://host:8080");
  expect("//host/a".match(ORIGIN_PREFIX)?.[0]).toBe("//host");
  expect("CUSTOM+v1://host/a".match(ORIGIN_PREFIX)?.[0]).toBe("CUSTOM+v1://host");
  expect("https://host?q=1".match(ORIGIN_PREFIX)?.[0]).toBe("https://host");
  for (const relative of ["/a/b", "a/b", "?q=1", "#hash", ""]) expect(ORIGIN_PREFIX.test(relative)).toBe(false);
  // 非全局正则：连续测试同一个串结果一致
  expect([ORIGIN_PREFIX.test("//h"), ORIGIN_PREFIX.test("//h")]).toEqual([true, true]);
});

it("[core.fn.hasOwn][core.fn.toTag] 自有字段不看原型；类型标签区分日期、查询串与普通对象", () => {
  expect(hasOwn(Object.fromEntries([["a", 1]]), "a")).toBe(true);
  expect(hasOwn(Object.setPrototypeOf({ a: 1 }, null), "a")).toBe(true);
  expect(hasOwn({}, "toString")).toBe(false);
  expect(hasOwn(Object.create({ inherited: 1 }), "inherited")).toBe(false);
  expect(toTag(new Date(0))).toBe("[object Date]");
  expect(toTag(new URLSearchParams())).toBe("[object URLSearchParams]");
  expect([toTag({}), toTag([]), toTag(null)]).toEqual(["[object Object]", "[object Array]", "[object Null]"]);
});

it("[core.fn.isEmptyScalar] null、undefined、NaN 与空白串为空；零、false、容器与有字非空串都不算空", () => {
  for (const empty of [null, undefined, NaN, "", "  ", "\t\n"]) expect(isEmptyScalar(empty)).toBe(true);
  for (const filled of [0, false, "a", " a ", {}, [], new Date(), 1n]) expect(isEmptyScalar(filled)).toBe(false);
});
