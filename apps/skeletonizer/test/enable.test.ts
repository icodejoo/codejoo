import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disable, enable, registerCustomElements, toggle } from "../src/enable.ts";
import type { EnableOptions } from "../src/enable.ts";
// 注册两个方案扩展（等同于用户导入 skeletonizer/all）
import { resetRootDrivenCache } from "../src/variants/global.ts";
import "../src/variants/svg.ts";

/** 最小假元素：只实现 enable / registerCustomElements 用到的那部分 DOM 接口 */
class FakeEl {
  /** 属性表 */
  attrs = new Map<string, string>();
  /** 原生 inert 状态 */
  inert = false;
  /** 标签名 */
  localName = "div";
  /** @param n 属性名 @param v 属性值 */
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  /** @param n 属性名 */
  getAttribute(n: string): string | null {
    return this.attrs.get(n) ?? null;
  }
  /** @param n 属性名 */
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
  /** 切换布尔属性
   * @param n 属性名 @param force 是否存在 */
  toggleAttribute(n: string, force: boolean): void {
    if (force) this.attrs.set(n, "");
    else this.attrs.delete(n);
  }
  /** 内联样式（占位桩） */
  style = { setProperty: (): void => {}, removeProperty: (): void => {} };
  /** 子元素 */
  children: FakeEl[] = [];
  /** 事件监听表 */
  listeners = new Map<string, (e: { timeStamp: number }) => void>();
  /** @param t 事件名 @param fn 回调 */
  addEventListener(t: string, fn: (e: { timeStamp: number }) => void): void {
    this.listeners.set(t, fn);
  }
  /** @param t 事件名 */
  removeEventListener(t: string): void {
    this.listeners.delete(t);
  }
  /** 只支持 [skz-ignore]：本元素是否被标记 */
  matches(): boolean {
    return this.attrs.has("skz-ignore");
  }
  /** 只支持 [skz-ignore]：子孙里有没有被标记的 */
  querySelector(): FakeEl | null {
    for (const c of this.children) {
      if (c.matches()) return c;
      const hit = c.querySelector();
      if (hit) return hit;
    }
    return null;
  }
  /**
   * 追加子元素
   * @param c 子元素
   * @returns 子元素本身
   */
  add(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
}

/** 把假元素当 HTMLElement 用 */
const asEl = (f: FakeEl): HTMLElement => f as unknown as HTMLElement;

/** 假的视口观察器：记录观察目标，测试里手动触发回调 */
class FakeIO {
  /** 最近创建的实例 */
  static last: FakeIO | null = null;
  /** 正在观察的元素 */
  targets = new Set<FakeEl>();
  /** 交叉回调 */
  cb: (entries: { target: FakeEl; isIntersecting: boolean }[]) => void;
  /** @param cb 交叉回调 */
  constructor(cb: (entries: { target: FakeEl; isIntersecting: boolean }[]) => void) {
    this.cb = cb;
    FakeIO.last = this;
  }
  /** @param t 目标 */
  observe(t: FakeEl): void {
    this.targets.add(t);
  }
  /** @param t 目标 */
  unobserve(t: FakeEl): void {
    this.targets.delete(t);
  }
}

beforeEach(() => {
  // 默认当作支持根驱动的现代浏览器；老浏览器的降级路径在 global.test.ts 里测
  vi.stubGlobal("CSS", { supports: () => true });
  resetRootDrivenCache();
  vi.stubGlobal("IntersectionObserver", FakeIO);
  // inert 走原生分支；observer 只需能 observe / disconnect
  // instanceof HTMLElement 对 FakeEl 成立；原型上有 inert 走原生分支
  vi.stubGlobal("HTMLElement", FakeEl);
  Object.defineProperty(FakeEl.prototype, "inert", { value: false, writable: true, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("enable：加根标记属性、aria-busy、inert，off 全部撤销并清掉选项属性", () => {
  const f = new FakeEl();
  const off = enable(asEl(f), { effect: "pulse", text: "leaf" });
  expect(f.getAttribute("skz")).toBe("");
  expect(f.getAttribute("aria-busy")).toBe("true");
  expect(f.getAttribute("skz-effect")).toBe("pulse");
  expect(f.getAttribute("skz-text")).toBe("leaf");
  expect(f.inert).toBe(true);
  off();
  expect(f.attrs.size).toBe(0);
  expect(f.inert).toBe(false);
});

it("fallback：不再写 skz-fallback 属性（降级由 JS 完成）", () => {
  const f = new FakeEl();
  const off = enable(asEl(f), { effect: "shimmer", fallback: "fade" });
  expect(f.getAttribute("skz-fallback")).toBeNull();
  enable(asEl(f), { effect: "pulse", fallback: "svg" });
  expect(f.getAttribute("skz-fallback")).toBeNull();
  off();
  expect(f.attrs.size).toBe(0);
});

it("enable 重入：返回同一个 off，不传的选项会被清掉", () => {
  const f = new FakeEl();
  const off = enable(asEl(f), { effect: "pulse", text: "leaf" });
  expect(enable(asEl(f), {})).toBe(off);
  expect(f.getAttribute("skz-effect")).toBeNull();
  expect(f.getAttribute("skz-text")).toBeNull();
});

it("toggle：按 loading 开关；disable 对未开启元素无副作用", () => {
  const f = new FakeEl();
  disable(asEl(f));
  expect(f.attrs.size).toBe(0);
  toggle(asEl(f), true, { text: "underline" });
  expect(f.getAttribute("skz")).toBe("");
  toggle(asEl(f), false);
  expect(f.attrs.size).toBe(0);
});

/** 假的可构造样式表 */
class FakeSheet {
  /** 最近一次写入的 CSS */
  css = "";
  /** replaceSync 调用次数 */
  writes = 0;
  /** @param css 新的样式文本 */
  replaceSync(css: string): void {
    this.css = css;
    this.writes++;
  }
}

/**
 * 造一个带 adoptedStyleSheets 的假 root。
 * @param tags 文档里的元素标签名
 */
function fakeRoot(tags: string[]) {
  return {
    adoptedStyleSheets: [] as FakeSheet[],
    ownerDocument: null,
    nodes: tags.map((localName) => ({ localName })),
    querySelectorAll(): { localName: string }[] {
      return this.nodes;
    },
  };
}

it("registerCustomElements：每次调用各持一张表，标签没变不重写，dispose 只摘自己的", () => {
  vi.stubGlobal("CSSStyleSheet", FakeSheet);
  const root = fakeRoot(["div", "sl-button", "skz"]);
  const asRoot = root as unknown as Document;

  const a = registerCustomElements(asRoot, { tags: ["MY-CARD"] });
  const b = registerCustomElements(asRoot);
  expect(root.adoptedStyleSheets).toHaveLength(2);

  const [sheetA] = root.adoptedStyleSheets;
  expect(a.refresh()).toEqual(["my-card", "sl-button"]);
  expect(sheetA.css).toContain("sl-button");
  expect(sheetA.css).not.toContain("skz:not");
  expect(sheetA.writes).toBe(1);

  root.nodes.push({ localName: "new-el" });
  a.refresh();
  expect(sheetA.writes).toBe(2);

  a.dispose();
  expect(root.adoptedStyleSheets).toHaveLength(1);
  b.dispose();
  expect(root.adoptedStyleSheets).toHaveLength(0);
});

it("忽略区：只锁不含忽略区的分支，忽略区自己保持可交互", () => {
  const root = new FakeEl();
  const plain = root.add(new FakeEl());
  const wrap = root.add(new FakeEl());
  const ignore = wrap.add(new FakeEl());
  ignore.setAttribute("skz-ignore", "");
  const sibling = wrap.add(new FakeEl());

  const off = enable(asEl(root));
  expect(root.inert).toBe(false);
  expect(wrap.inert).toBe(false);
  expect(ignore.inert).toBe(false);
  expect(plain.inert).toBe(true);
  expect(sibling.inert).toBe(true);
  off();
  expect(plain.inert).toBe(false);
  expect(sibling.inert).toBe(false);
});

it("懒渲染：根离开视口打上 skz-paused，回来去掉；关闭时取消观察", () => {
  const f = new FakeEl();
  const off = enable(asEl(f), { effect: "shimmer" });
  const io = FakeIO.last!;
  expect(io.targets.has(f)).toBe(true);

  io.cb([{ target: f, isIntersecting: false }]);
  expect(f.getAttribute("skz-paused")).toBe("");
  io.cb([{ target: f, isIntersecting: true }]);
  expect(f.getAttribute("skz-paused")).toBeNull();

  io.cb([{ target: f, isIntersecting: false }]);
  off();
  expect(io.targets.has(f)).toBe(false);
  expect(f.getAttribute("skz-paused")).toBeNull();
});

it("skz-has-ignore：根里有忽略区才打上，重入时重新检测，关闭时移除", () => {
  const root = new FakeEl();
  const ignore = root.add(new FakeEl());
  ignore.setAttribute("skz-ignore", "");
  const off = enable(asEl(root));
  expect(root.getAttribute("skz-has-ignore")).toBe("");

  root.children = [];
  enable(asEl(root));
  expect(root.getAttribute("skz-has-ignore")).toBeNull();

  root.add(ignore);
  enable(asEl(root));
  off();
  expect(root.getAttribute("skz-has-ignore")).toBeNull();
});

it("engine：enable 自己不写 skz-engine（由 svg 扩展挂上 blob 后写，见 global.test.ts / svg.test.ts）", () => {
  // 测试环境没有 blob / 主题变量，svg 扩展挂不上，所以任何选项下都不会出现 engine 属性
  const f = new FakeEl();
  const off = enable(asEl(f), { effect: "shimmer", engine: "svg" });
  expect(f.getAttribute("skz-engine")).toBeNull();
  enable(asEl(f), { effect: "shimmer", engine: "global" });
  expect(f.getAttribute("skz-engine")).toBeNull();
  off();
  expect(f.attrs.size).toBe(0);
});

it("mode 选项已删除：即使传了也不会写 skz-mode", () => {
  const f = new FakeEl();
  const off = enable(asEl(f), { mode: "explicit" } as EnableOptions);
  expect(f.getAttribute("skz-mode")).toBeNull();
  off();
});

it("防火墙：只在 css 方案的 pulse / shimmer 下给列表项打标记，换效果或关闭时撤掉", () => {
  const root = new FakeEl();
  const cards = [root.add(new FakeEl()), root.add(new FakeEl()), root.add(new FakeEl())];
  const marked = (): boolean => cards.every((c) => c.getAttribute("skz-fw") === "");
  const off = enable(asEl(root), { effect: "shimmer" });
  expect(marked()).toBe(true);
  enable(asEl(root), { effect: "shimmer", engine: "svg" });
  expect(cards.some((c) => c.getAttribute("skz-fw") !== null)).toBe(false);
  enable(asEl(root), { effect: "pulse" });
  expect(marked()).toBe(true);
  enable(asEl(root), { effect: "fade" });
  expect(cards.some((c) => c.getAttribute("skz-fw") !== null)).toBe(false);
  enable(asEl(root), { effect: "pulse" });
  off();
  expect(cards.some((c) => c.getAttribute("skz-fw") !== null)).toBe(false);
});

describe("按已加载的变体决定方案", () => {
  /**
   * 重新加载一份干净的核心，并按需注册变体
   * @param variants 要注册的变体
   * @returns 新模块里的 enable
   */
  async function fresh(variants: Array<"global" | "svg">): Promise<typeof enable> {
    vi.resetModules();
    const mod = await import("../src/enable.ts");
    for (const v of variants) await import(`../src/variants/${v}.ts`);
    return mod.enable;
  }
  /**
   * 造一个带 3 个列表项的根
   * @returns 根与列表项
   */
  function rootWithItems(): { root: FakeEl; items: FakeEl[] } {
    const root = new FakeEl();
    return { root, items: [root.add(new FakeEl()), root.add(new FakeEl()), root.add(new FakeEl())] };
  }

  it("只加载 svg：默认走 svg 扩展（不启用防火墙）；engine 属性由扩展挂上 blob 后才写，这里没有 blob 环境", async () => {
    const en = await fresh(["svg"]);
    const { root, items } = rootWithItems();
    en(asEl(root), { effect: "shimmer" });
    expect(root.getAttribute("skz-engine")).toBeNull();
    expect(items.some((c) => c.getAttribute("skz-fw") !== null)).toBe(false);
  });

  it("什么都没加载：按 global 走纯 CSS，不写 engine、不启用防火墙", async () => {
    const en = await fresh([]);
    const { root, items } = rootWithItems();
    en(asEl(root), { effect: "pulse" });
    expect(root.getAttribute("skz-engine")).toBeNull();
    expect(items.some((c) => c.getAttribute("skz-fw") !== null)).toBe(false);
  });

  it("只加载 global：默认 global，启用防火墙", async () => {
    const en = await fresh(["global"]);
    const { root, items } = rootWithItems();
    en(asEl(root), { effect: "shimmer" });
    expect(root.getAttribute("skz-engine")).toBeNull();
    expect(items.every((c) => c.getAttribute("skz-fw") === "")).toBe(true);
  });

  it("两个都加载：默认 global；显式 engine: svg 时撤掉防火墙", async () => {
    const en = await fresh(["global", "svg"]);
    const { root, items } = rootWithItems();
    en(asEl(root), { effect: "shimmer" });
    expect(items.every((c) => c.getAttribute("skz-fw") === "")).toBe(true);
    en(asEl(root), { effect: "shimmer", engine: "svg" });
    expect(items.some((c) => c.getAttribute("skz-fw") !== null)).toBe(false);
  });
});

describe("syncExtensions 分两遍", () => {
  /**
   * 注册两个会记录调用顺序的假扩展（先 global 后 svg），返回新模块的 enable 和调用日志
   * @returns enable 与日志
   */
  async function withLoggedExtensions(): Promise<{ en: typeof enable; log: string[] }> {
    vi.resetModules();
    const mod = await import("../src/enable.ts");
    const log: string[] = [];
    for (const engine of ["global", "svg"] as const) {
      mod.registerExtension({
        engine,
        sync: () => void log.push("sync:" + engine),
        release: () => void log.push("release:" + engine),
      });
    }
    return { en: mod.enable, log };
  }

  it("先撤掉所有未选中的扩展，再同步选中的（选中的在注册表里排在前面也一样）", async () => {
    const { en, log } = await withLoggedExtensions();
    en(asEl(new FakeEl()), { effect: "shimmer" });
    expect(log).toEqual(["release:svg", "sync:global"]);
  });

  it("非 pulse / shimmer：全部只撤不同步", async () => {
    const { en, log } = await withLoggedExtensions();
    en(asEl(new FakeEl()), { effect: "fade" });
    expect(log).toEqual(["release:global", "release:svg"]);
  });
});

it("fit：开启写 skz-fit 与 max-height，重入不传 fit 或 off 时完整撤销；与防火墙同时开互不干扰", () => {
  vi.stubGlobal("window", { innerHeight: 600, addEventListener: (): void => {}, removeEventListener: (): void => {} });
  vi.stubGlobal("document", { body: {}, documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({ overflowY: "visible", overflow: "visible" }));
  const root = new FakeEl();
  const props = new Map<string, string>();
  Object.assign(root, {
    parentElement: null,
    getBoundingClientRect: () => ({ top: 100 }),
    style: {
      setProperty: (k: string, v: string): void => void props.set(k, v),
      removeProperty: (k: string): void => void props.delete(k),
    },
  });
  const cards = [root.add(new FakeEl()), root.add(new FakeEl())];
  cards.forEach((c, i) => Object.assign(c, { getBoundingClientRect: () => ({ top: i === 0 ? 100 : 900 }) }));

  const off = enable(asEl(root), { effect: "pulse", fit: true });
  expect(root.getAttribute("skz-fit")).toBe("");
  expect(props.get("max-height")).toBe("500px");
  expect(cards[1]!.getAttribute("skz-fit-hide")).toBe("");
  expect(cards.every((c) => c.getAttribute("skz-fw") === "")).toBe(true);

  enable(asEl(root), { effect: "pulse" });
  expect(root.getAttribute("skz-fit")).toBeNull();
  expect(props.has("max-height")).toBe(false);
  expect(cards[1]!.getAttribute("skz-fit-hide")).toBeNull();

  enable(asEl(root), { fit: true });
  expect(root.getAttribute("skz-fit")).toBe("");
  off();
  expect(root.getAttribute("skz-fit")).toBeNull();
  expect(props.has("max-height")).toBe(false);
  expect(root.attrs.size).toBe(0);
});
