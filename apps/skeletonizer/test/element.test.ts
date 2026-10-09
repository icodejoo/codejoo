// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineSkzBox } from "../src/element.js";
import type { SkzBox } from "../src/element.js";
import { ROOT_ATTR } from "../src/enable.js";

/** 视口观察器桩（jsdom 没有 IntersectionObserver） */
const observe = vi.fn();
const unobserve = vi.fn();

/** 焦点拦截监听的事件名 */
const LOCK_EVENT = "focusin";
/** aria-busy 属性名 */
const ARIA_BUSY = "aria-busy";
/** 属性名：loading */
const ATTR_LOADING = "loading";
/** 标签名：div */
const TAG_DIV = "div";
/** 动画效果：pulse */
const EFFECT_PULSE = "pulse";
/** 字符串常量：true */
const STR_TRUE = "true";
/** 字符串常量：false */
const STR_FALSE = "false";

/**
 * 建一个 <skz-box> 并挂到 parent
 * @param parent 父节点
 * @param attrs 初始属性
 * @returns 元素
 * @example mount(document.body, { loading: "" });
 */
function mount(parent: HTMLElement = document.body, attrs: Record<string, string> = {}): SkzBox {
  const el = document.createElement("skz-box") as SkzBox;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
}

/** 锁事件计数 */
interface LockCount {
  /** 上锁次数 */
  add: number;
  /** 解锁次数 */
  remove: number;
}

/**
 * 统计某元素上锁 / 解锁的次数
 * @param el 元素
 * @returns 实时计数
 * @example const lock = countLock(el);
 */
function countLock(el: HTMLElement): LockCount {
  const n: LockCount = { add: 0, remove: 0 };
  const add = el.addEventListener.bind(el);
  const remove = el.removeEventListener.bind(el);
  el.addEventListener = (type: string, ...rest: [EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?]): void => {
    if (type === LOCK_EVENT) n.add++;
    add(type, ...rest);
  };
  el.removeEventListener = (type: string, ...rest: [EventListenerOrEventListenerObject, (boolean | EventListenerOptions)?]): void => {
    if (type === LOCK_EVENT) n.remove++;
    remove(type, ...rest);
  };
  return n;
}

beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = observe;
      unobserve = unobserve;
      disconnect = vi.fn();
    },
  );
  defineSkzBox();
});

describe("SkzBox", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    observe.mockClear();
    unobserve.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("开 / 关：作用在第一个子元素上，宿主自身不带 skz", () => {
    const el = mount(document.body, { [ATTR_LOADING]: "", effect: EFFECT_PULSE });
    const child = document.createElement(TAG_DIV);
    el.appendChild(child);

    // 子节点是连接之后才加的，切一下 loading 让它接管
    el.loading = false;
    el.loading = true;

    expect(el.hasAttribute(ROOT_ATTR)).toBe(false);
    expect(el.hasAttribute(ARIA_BUSY)).toBe(false);
    expect(child.hasAttribute(ROOT_ATTR)).toBe(true);
    expect(child.getAttribute(ARIA_BUSY)).toBe(STR_TRUE);
    expect(child.getAttribute("skz-effect")).toBe(EFFECT_PULSE);

    el.loading = false;
    expect(child.hasAttribute(ROOT_ATTR)).toBe(false);
    expect(child.hasAttribute(ARIA_BUSY)).toBe(false);
    expect(el.hasAttribute(ROOT_ATTR)).toBe(false);
  });

  it("带子元素和 loading 一起挂载时，connectedCallback 直接接管第一个子元素", () => {
    const el = document.createElement("skz-box") as SkzBox;
    el.setAttribute(ATTR_LOADING, "");
    const first = document.createElement(TAG_DIV);
    const second = document.createElement(TAG_DIV);
    el.append(first, second);
    document.body.appendChild(el);

    expect(first.hasAttribute(ROOT_ATTR)).toBe(true);
    expect(second.hasAttribute(ROOT_ATTR)).toBe(false);
    expect(el.hasAttribute(ROOT_ATTR)).toBe(false);
  });

  it("没有子元素时不报错", () => {
    const el = mount();
    expect(() => {
      el.loading = true;
      el.loading = false;
    }).not.toThrow();
  });

  it("反复切换多次之后，inert / aria-busy 都没有残留，也没有重复", () => {
    const el = mount();
    const child = document.createElement(TAG_DIV);
    el.appendChild(child);
    const lock = countLock(child);

    for (let i = 0; i < 3; i++) {
      el.loading = true;
      el.loading = false;
    }

    expect(lock.add).toBe(3);
    expect(lock.remove).toBe(3);
    expect(observe).toHaveBeenCalledTimes(3);
    expect(unobserve).toHaveBeenCalledTimes(3);
    expect(child.hasAttribute(ARIA_BUSY)).toBe(false);
    expect(child.hasAttribute(ROOT_ATTR)).toBe(false);
    expect(el.hasAttribute(ROOT_ATTR)).toBe(false);
  });

  it("移动节点：加载中的宿主 append 到别的父节点后，子根仍保持状态", () => {
    const a = document.createElement(TAG_DIV);
    const b = document.createElement(TAG_DIV);
    document.body.append(a, b);

    const el = mount(a);
    const child = document.createElement(TAG_DIV);
    el.appendChild(child);
    el.loading = true;

    const lock = countLock(child);

    // 移动宿主
    b.appendChild(el);
    expect(el.loading).toBe(true);
    // connectedCallback 触发重新 sync
    // connected 之前 disconnected 会 disable
    expect(lock.remove).toBe(1);
    expect(lock.add).toBe(1);
    expect(child.hasAttribute(ROOT_ATTR)).toBe(true);

    el.loading = false;
    expect(child.hasAttribute(ROOT_ATTR)).toBe(false);
    expect(child.hasAttribute(ARIA_BUSY)).toBe(false);
  });

  it("子根被替换后切一次 loading，新子根生效、旧子根被 disable", () => {
    const el = mount();
    const oldChild = document.createElement(TAG_DIV);
    el.appendChild(oldChild);
    el.loading = true;

    expect(oldChild.hasAttribute(ROOT_ATTR)).toBe(true);

    const newChild = document.createElement(TAG_DIV);
    // 替换子节点
    el.replaceChild(newChild, oldChild);

    // 切一下 loading 触发同步
    el.loading = false;
    el.loading = true;

    expect(oldChild.hasAttribute(ROOT_ATTR)).toBe(false);
    expect(newChild.hasAttribute(ROOT_ATTR)).toBe(true);
  });

  it('loading 属性值为 "false" 时视为关闭，其他视为开启', () => {
    const el = mount();
    el.setAttribute(ATTR_LOADING, STR_FALSE);
    expect(el.loading).toBe(false);

    el.setAttribute(ATTR_LOADING, "");
    expect(el.loading).toBe(true);

    el.setAttribute(ATTR_LOADING, STR_TRUE);
    expect(el.loading).toBe(true);
  });

  it("fit 属性透传：存在且不为 false 即开，开启时子根带 skz-fit，去掉或写 false 后撤销", () => {
    const el = mount(document.body, { [ATTR_LOADING]: "", fit: "" });
    const child = document.createElement(TAG_DIV);
    el.appendChild(child);
    el.loading = false;
    el.loading = true;
    expect(child.hasAttribute("skz-fit")).toBe(true);

    el.setAttribute("fit", STR_FALSE);
    expect(child.hasAttribute("skz-fit")).toBe(false);

    el.setAttribute("fit", STR_TRUE);
    expect(child.hasAttribute("skz-fit")).toBe(true);

    el.removeAttribute("fit");
    expect(child.hasAttribute("skz-fit")).toBe(false);
    el.loading = false;
    expect(child.hasAttribute("skz-fit")).toBe(false);
  });
});
