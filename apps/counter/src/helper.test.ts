import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLazyObserver, lazyStart } from "./helper";

/** observer 实例 → 其派发回调，供 trigger 模拟元素进入视口 */
const callbacks = new WeakMap<object, IntersectionObserverCallback>();
/** 被 unobserve 过的元素记录 */
let unobserved: Element[] = [];

/** 假 IntersectionObserver：只登记回调与 unobserve 调用，不做真实观察 */
class FakeIO {
  constructor(cb: IntersectionObserverCallback) {
    callbacks.set(this, cb);
  }
  observe() {}
  unobserve(el: Element) {
    unobserved.push(el);
  }
}

/** 模拟 el 进入视口：以 ob 自身作第二参调用其派发回调（与浏览器行为一致） */
function trigger(ob: IntersectionObserver, el: Element) {
  const rect = el.getBoundingClientRect();
  const entry: IntersectionObserverEntry = { boundingClientRect: rect, intersectionRatio: 1, intersectionRect: rect, isIntersecting: true, rootBounds: null, target: el, time: 0 };
  callbacks.get(ob)?.([entry], ob);
}

describe("lazyStart 同元素多条懒注册", () => {
  beforeEach(() => {
    unobserved = [];
    vi.stubGlobal("IntersectionObserver", FakeIO);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("同一 observer 下的多条注册在一次 entry 中全部触发（元素持续可见不会再有第二次 entry）", () => {
    const el = document.createElement("div");
    const ob = createLazyObserver();
    const a = vi.fn();
    const b = vi.fn();
    lazyStart(el, a, ob);
    lazyStart(el, b, ob);
    trigger(ob, el);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(unobserved).toContain(el);
    trigger(ob, el); // 已摘空，重复触发不再回调
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("属于其他 observer 的注册保留，留给各自的 observer 触发", () => {
    const el = document.createElement("div");
    const ob1 = createLazyObserver();
    const ob2 = createLazyObserver();
    const a = vi.fn();
    const b = vi.fn();
    lazyStart(el, a, ob1);
    lazyStart(el, b, ob2);
    trigger(ob1, el);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    trigger(ob2, el);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("同批里 A 的回调取消 B：不抛错，且 B 不会再被执行", () => {
    const el = document.createElement("div");
    const ob = createLazyObserver();
    const b = vi.fn();
    const cancels: (() => void)[] = [];
    lazyStart(el, () => cancels.forEach((c) => c()), ob);
    cancels.push(lazyStart(el, b, ob));
    expect(() => trigger(ob, el)).not.toThrow();
    expect(b).not.toHaveBeenCalled();
  });
});
