import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** 根上的 fit 标记属性 */
const FIT = "skz-fit";
/** 列表项的隐藏标记属性 */
const HIDE = "skz-fit-hide";
/** 视口高度（桩） */
const VIEWPORT_H = 800;

/** 最小假元素：只实现 fit 用到的 DOM 接口 */
class FakeEl {
  /** 属性表 */
  attrs = new Map<string, string>();
  /** 子元素 */
  children: FakeEl[] = [];
  /** 父元素 */
  parentElement: FakeEl | null = null;
  /** 内联样式表 */
  styles = new Map<string, string>();
  /** 内联样式：setProperty / removeProperty，空了之后 style 属性留一个 "" 模拟浏览器 */
  style = {
    setProperty: (k: string, v: string): void => {
      this.styles.set(k, v);
      this.attrs.set("style", "x");
    },
    removeProperty: (k: string): void => {
      this.styles.delete(k);
      if (!this.styles.size) this.attrs.set("style", "");
    },
  };
  /** 边框厚度 */
  clientTop = 0;
  /** 可视区高度 */
  clientHeight = 0;
  /** 视口坐标下的顶边 */
  top = 0;
  /** 内容总高度（判断是否仍可滚动用） */
  scrollHeight = 0;
  /** 已滚动的距离 */
  scrollTop = 0;
  /** 计算样式 overflow-y */
  overflowY = "visible";

  /** @param n 属性名 @param v 属性值 */
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  /** @param n 属性名 */
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
  /** @param n 属性名 */
  getAttribute(n: string): string | null {
    return this.attrs.get(n) ?? null;
  }
  /** @returns 顶边矩形 */
  getBoundingClientRect(): { top: number } {
    return { top: this.top };
  }
  /**
   * 追加 n 个子元素，按 step 间距依次排布顶边（相对本元素顶边）
   * @param n 个数
   * @param step 间距
   * @returns 新增的子元素
   */
  addItems(n: number, step: number): FakeEl[] {
    const out = Array.from({ length: n }, (_, i) => {
      const c = new FakeEl();
      c.parentElement = this;
      c.top = this.top + i * step;
      return c;
    });
    this.children.push(...out);
    return out;
  }
}

/** 假 ResizeObserver：记录观察目标，测试里手动触发回调 */
class FakeRO {
  /** 最近创建的实例 */
  static last: FakeRO | null = null;
  /** 观察目标 */
  targets = new Set<FakeEl>();
  /** 是否已断开 */
  disconnected = false;
  /** 回调 */
  cb: () => void;
  /** @param cb 回调 */
  constructor(cb: () => void) {
    this.cb = cb;
    FakeRO.last = this;
  }
  /** @param t 目标 */
  observe(t: FakeEl): void {
    this.targets.add(t);
  }
  /** 断开 */
  disconnect(): void {
    this.disconnected = true;
    this.targets.clear();
  }
}

/** 待执行的 rAF 回调，测试里手动 flush */
let rafQueue: Map<number, () => void>;
/** rAF id 自增 */
let rafId: number;
/** window resize 监听表 */
let winListeners: Map<string, () => void>;

/**
 * 执行并清空所有待执行的 rAF
 * @example flushRaf();
 */
function flushRaf(): void {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of cbs) cb();
}

/** 把假元素当 HTMLElement 用 */
const asEl = (f: FakeEl): HTMLElement => f as unknown as HTMLElement;

/**
 * 造一个根：下面套一层包裹，再有 n 个列表项（firewallItems 会穿过单子元素的包裹层）
 * @param n 列表项个数
 * @param step 每项高度
 * @param rootTop 根顶边
 * @returns 根与列表项
 */
function makeRoot(n: number, step: number, rootTop: number): { root: FakeEl; items: FakeEl[] } {
  const root = new FakeEl();
  root.top = rootTop;
  const wrap = root.addItems(1, 0)[0]!;
  wrap.top = rootTop;
  const items = wrap.addItems(n, step);
  return { root, items };
}

/**
 * 造一个滚动祖先并挂上根
 * @param root 根
 * @param top 容器顶边
 * @param height 容器可视高度
 * @returns 容器
 */
function wrapInScroller(root: FakeEl, top: number, height: number): FakeEl {
  const box = new FakeEl();
  box.top = top;
  box.clientHeight = height;
  box.overflowY = "auto";
  root.parentElement = box;
  box.children.push(root);
  return box;
}

beforeEach(() => {
  vi.resetModules();
  FakeRO.last = null;
  rafQueue = new Map();
  rafId = 0;
  winListeners = new Map();
  vi.stubGlobal("ResizeObserver", FakeRO);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void): number => {
    rafQueue.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    rafQueue.delete(id);
  });
  vi.stubGlobal("window", {
    innerHeight: VIEWPORT_H,
    addEventListener: (t: string, fn: () => void): void => {
      winListeners.set(t, fn);
    },
    removeEventListener: (t: string): void => {
      winListeners.delete(t);
    },
  });
  vi.stubGlobal("document", { body: new FakeEl(), documentElement: new FakeEl() });
  vi.stubGlobal("getComputedStyle", (el: FakeEl) => ({ overflowY: el.overflowY, overflow: el.overflowY }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("滚动祖先：max-height = 容器底边 - 根顶边，完全落在其外的项被隐藏", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root, items } = makeRoot(5, 100, 100);
  const box = wrapInScroller(root, 50, 500); // 底边 550，可用 450
  enableFit(asEl(root));

  expect(root.attrs.has(FIT)).toBe(true);
  expect(root.styles.get("max-height")).toBe("450px");
  // 项顶边相对根顶：0 100 200 300 400，都 < 450：露出一部分的项不隐藏
  expect(items.map((i) => i.attrs.has(HIDE))).toEqual([false, false, false, false, false]);

  root.top = 200; // 根下移后重算：可用 350，相对顶 400 的项被隐藏
  items.forEach((item, i) => (item.top = 200 + i * 100));
  box.clientHeight = 500;
  FakeRO.last!.cb();
  flushRaf();
  expect(root.styles.get("max-height")).toBe("350px");
  expect(items.map((i) => i.attrs.has(HIDE))).toEqual([false, false, false, false, true]);
});

it("边界含边框：底边 = top + clientTop + clientHeight", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root } = makeRoot(3, 100, 0);
  const box = wrapInScroller(root, 10, 300);
  box.clientTop = 2;
  enableFit(asEl(root));
  expect(root.styles.get("max-height")).toBe("312px");
});

it("视口边界：没有滚动祖先时用 innerHeight，监听 window resize 而不是 ResizeObserver", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root, items } = makeRoot(10, 100, 200);
  const outer = new FakeEl(); // overflow: visible 的普通祖先不算边界
  root.parentElement = outer;
  enableFit(asEl(root));

  expect(root.styles.get("max-height")).toBe("600px");
  expect(items.filter((i) => i.attrs.has(HIDE)).length).toBe(4); // 顶边 600~900 的 4 项
  expect(items[5]!.attrs.has(HIDE)).toBe(false);
  expect(FakeRO.last).toBeNull();
  expect(winListeners.has("resize")).toBe(true);
});

it("html / body 上的 overflow 传给视口，按视口算", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root } = makeRoot(3, 100, 0);
  const body = (document as unknown as { body: FakeEl }).body;
  body.overflowY = "auto";
  body.clientHeight = 99999;
  root.parentElement = body;
  enableFit(asEl(root));
  expect(root.styles.get("max-height")).toBe(`${VIEWPORT_H}px`);
});

it("视口 resize：rAF 合并多次触发，变大后被隐藏的项恢复，变小后更多项隐藏", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root, items } = makeRoot(10, 100, 0);
  enableFit(asEl(root));
  expect(items.filter((i) => i.attrs.has(HIDE)).length).toBe(2); // 800 / 100 = 8 项可见

  const w = (globalThis as unknown as { window: { innerHeight: number } }).window;
  w.innerHeight = 400;
  winListeners.get("resize")!();
  winListeners.get("resize")!();
  expect(rafQueue.size).toBe(1);
  flushRaf();
  expect(root.styles.get("max-height")).toBe("400px");
  expect(items.filter((i) => i.attrs.has(HIDE)).length).toBe(6);

  w.innerHeight = 2000;
  winListeners.get("resize")!();
  flushRaf();
  expect(root.styles.get("max-height")).toBe("2000px");
  expect(items.filter((i) => i.attrs.has(HIDE)).length).toBe(0);
});

it("可用高度下限为 0：根已在边界下方时 max-height 为 0px", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root } = makeRoot(3, 100, 5000);
  enableFit(asEl(root));
  expect(root.styles.get("max-height")).toBe("0px");
});

it("disableFit：清 max-height、style 属性、隐藏标记、skz-fit，断开监听并取消待执行的 rAF", async () => {
  const { enableFit, disableFit } = await import("../src/fit.ts");
  const { root, items } = makeRoot(10, 100, 0);
  const box = wrapInScroller(root, 0, 300);
  void box;
  enableFit(asEl(root));
  const ro = FakeRO.last!;
  ro.cb(); // 排一个待执行的 rAF
  expect(rafQueue.size).toBe(1);

  disableFit(asEl(root));
  expect(root.attrs.has(FIT)).toBe(false);
  expect(root.styles.size).toBe(0);
  expect(root.attrs.has("style")).toBe(false);
  expect(items.some((i) => i.attrs.has(HIDE))).toBe(false);
  expect(ro.disconnected).toBe(true);
  expect(rafQueue.size).toBe(0);

  // 视口情况：resize 监听被摘掉
  const b = makeRoot(3, 100, 0);
  enableFit(asEl(b.root));
  expect(winListeners.has("resize")).toBe(true);
  disableFit(asEl(b.root));
  expect(winListeners.has("resize")).toBe(false);
});

it("disableFit：没开启过、重复关闭都安全，也不动用户自己写的 skz-fit", async () => {
  const { disableFit } = await import("../src/fit.ts");
  const root = new FakeEl();
  root.setAttribute(FIT, "");
  expect(() => disableFit(asEl(root))).not.toThrow();
  expect(root.attrs.has(FIT)).toBe(true);
});

it("幂等：重复 enableFit 只留一份监听，并按新位置重测", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root } = makeRoot(3, 100, 0);
  const box = wrapInScroller(root, 0, 500);
  enableFit(asEl(root));
  const first = FakeRO.last!;
  root.top = 100;
  enableFit(asEl(root));
  expect(first.disconnected).toBe(true);
  expect(FakeRO.last).not.toBe(first);
  expect(FakeRO.last!.targets.has(box)).toBe(true);
  expect(root.styles.get("max-height")).toBe("400px");
});

it("无 ResizeObserver：滚动祖先情况只测一次，不报错", async () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const { enableFit } = await import("../src/fit.ts");
  const { root } = makeRoot(3, 100, 0);
  wrapInScroller(root, 0, 300);
  expect(() => enableFit(asEl(root))).not.toThrow();
  expect(root.styles.get("max-height")).toBe("300px");
});

it("SSR（无 window / document）：什么都不做，不报错", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
  const { enableFit, disableFit } = await import("../src/fit.ts");
  const root = new FakeEl();
  expect(() => enableFit(asEl(root))).not.toThrow();
  expect(() => disableFit(asEl(root))).not.toThrow();
  expect(root.attrs.size).toBe(0);
});

it("与防火墙互不干扰：fit 只动 skz-fit-hide，不碰 skz-fw", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root, items } = makeRoot(10, 100, 0);
  for (const i of items) i.setAttribute("skz-fw", "");
  enableFit(asEl(root));
  expect(items.every((i) => i.attrs.has("skz-fw"))).toBe(true);
  expect(items[9]!.attrs.has(HIDE)).toBe(true);
});

it("已滚动：页面 / 容器滚过一段后，结果与滚动位置无关（按滚动为 0 时的位置算）", async () => {
  const { enableFit } = await import("../src/fit.ts");
  // 页面滚了 100：视口里根顶 100，页面里顶是 200，可用 600
  (globalThis as unknown as { window: { scrollY: number } }).window.scrollY = 100;
  const a = makeRoot(3, 100, 100);
  enableFit(asEl(a.root));
  expect(a.root.styles.get("max-height")).toBe("600px");

  // 容器滚了 50：视口里根顶 50，滚动为 0 时是 100，容器底边 300，可用 200
  const b = makeRoot(3, 100, 50);
  const box = wrapInScroller(b.root, 0, 300);
  box.scrollTop = 50;
  enableFit(asEl(b.root));
  expect(b.root.styles.get("max-height")).toBe("200px");
});

/**
 * 取桩里的 documentElement（视口的滚动元素）
 * @returns 假的 documentElement
 */
const docEl = (): FakeEl => (document as unknown as { documentElement: FakeEl }).documentElement;

it("视口：骨架在首屏以下、页面本来就可滚 → 放宽为一屏高，项不会被全部隐藏", async () => {
  const { enableFit } = await import("../src/fit.ts");
  docEl().clientHeight = VIEWPORT_H;
  docEl().scrollHeight = 6000;
  const { root, items } = makeRoot(10, 100, 5000);
  enableFit(asEl(root));
  expect(root.styles.get("max-height")).toBe(`${VIEWPORT_H}px`);
  // 一屏 800 / 每项 100：前 8 项可见，后 2 项隐藏（按公式会是 0px 全隐藏）
  expect(items.filter((i) => i.attrs.has(HIDE)).length).toBe(2);
  expect(items[0]!.attrs.has(HIDE)).toBe(false);
});

it("视口：骨架在首屏内、下方有别的内容使页面本来就可滚 → 同样放宽为一屏高", async () => {
  const { enableFit } = await import("../src/fit.ts");
  docEl().clientHeight = VIEWPORT_H;
  docEl().scrollHeight = 3000;
  const { root } = makeRoot(10, 100, 200);
  enableFit(asEl(root));
  expect(root.styles.get("max-height")).toBe(`${VIEWPORT_H}px`);
});

it("视口：首屏内且页面不可滚 → 贴底（不放宽）；之后页面变可滚再 resize 才放宽，变回不可滚又收回", async () => {
  const { enableFit } = await import("../src/fit.ts");
  docEl().clientHeight = VIEWPORT_H;
  docEl().scrollHeight = VIEWPORT_H; // 与可视高相同
  const { root } = makeRoot(10, 100, 200);
  enableFit(asEl(root));
  expect(root.styles.get("max-height")).toBe("600px");

  docEl().scrollHeight = VIEWPORT_H + 1; // 1px 取整误差内，不算可滚
  winListeners.get("resize")!();
  flushRaf();
  expect(root.styles.get("max-height")).toBe("600px");

  docEl().scrollHeight = 2000;
  winListeners.get("resize")!();
  flushRaf();
  expect(root.styles.get("max-height")).toBe(`${VIEWPORT_H}px`);

  docEl().scrollHeight = VIEWPORT_H;
  winListeners.get("resize")!();
  flushRaf();
  expect(root.styles.get("max-height")).toBe("600px");
});

it("容器：骨架在容器可视区以下、容器本来就可滚 → 放宽为容器可视高，项不会被全部隐藏", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const { root, items } = makeRoot(10, 100, 1000);
  const box = wrapInScroller(root, 0, 300);
  box.scrollHeight = 2000;
  enableFit(asEl(root));
  expect(root.styles.get("max-height")).toBe("300px");
  expect(items.filter((i) => i.attrs.has(HIDE)).length).toBe(7); // 偏移 0~200 的 3 项可见
});

it("容器：骨架在容器内且容器不可滚 → 贴底；容器下方内容把容器撑出滚动 → 放宽", async () => {
  const { enableFit } = await import("../src/fit.ts");
  const a = makeRoot(10, 100, 100);
  const boxA = wrapInScroller(a.root, 0, 500);
  boxA.scrollHeight = 500;
  enableFit(asEl(a.root));
  expect(a.root.styles.get("max-height")).toBe("400px");

  const b = makeRoot(10, 100, 100);
  const boxB = wrapInScroller(b.root, 0, 500);
  boxB.scrollHeight = 900;
  enableFit(asEl(b.root));
  expect(b.root.styles.get("max-height")).toBe("500px");
});
