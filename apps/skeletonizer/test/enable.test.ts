import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disable, enable } from "../src/core/enable.ts";
import type { EnableOptions } from "../src/core/types.ts";
// 完整版入口：注册 text / engine / lazy 扩展，再注册两个方案（等同于用户导入 skeletonizer）
import "../src/full/index.ts";
import { resetRootDrivenCache } from "../src/full/variants/global.ts";
import "../src/full/variants/svg.ts";
import { asEl, FakeEl, FakeIO, fresh, loadFull } from "./helpers.ts";

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
  expect(f.getAttribute("skz-text-mode")).toBe("leaf");
  expect(f.inert).toBe(true);
  off();
  expect(f.attrs.size).toBe(0);
  expect(f.inert).toBe(false);
});

it("text：五种模式都原样写到 skz-text-mode（根属性，不是元素级标记 skz-text）；不传 = 不写属性（默认 round，纯 CSS 的缺省就是 round，JS 与无 JS 结果一致）", () => {
  const f = new FakeEl();
  const off = enable(asEl(f), { effect: "shimmer" });
  expect(f.getAttribute("skz-text-mode")).toBeNull();
  for (const mode of ["round", "clip", "underline", "leaf"] as const) {
    enable(asEl(f), { effect: "shimmer", text: mode });
    expect(f.getAttribute("skz-text-mode")).toBe(mode);
  }
  // 再次调用不传 text：属性被清掉，回到默认（round）
  enable(asEl(f), { effect: "shimmer" });
  expect(f.getAttribute("skz-text-mode")).toBeNull();
  off();
  expect(f.attrs.size).toBe(0);
});

it("shimmerMode：原样写到 skz-shimmer-mode；不传 = 不写属性（默认 even，纯 CSS 的缺省就是 even）；off 撤销", () => {
  const f = new FakeEl();
  const off = enable(asEl(f), { effect: "shimmer" });
  expect(f.getAttribute("skz-shimmer-mode")).toBeNull();
  for (const mode of ["even", "fit"] as const) {
    enable(asEl(f), { effect: "shimmer", shimmerMode: mode });
    expect(f.getAttribute("skz-shimmer-mode")).toBe(mode);
  }
  enable(asEl(f), { effect: "shimmer" });
  expect(f.getAttribute("skz-shimmer-mode")).toBeNull();
  off();
  expect(f.attrs.size).toBe(0);
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
  expect(f.getAttribute("skz-text-mode")).toBeNull();
});

it("disable：对未开启元素无副作用，开启后能关掉", () => {
  const f = new FakeEl();
  disable(asEl(f));
  expect(f.attrs.size).toBe(0);
  enable(asEl(f), { text: "underline" });
  expect(f.getAttribute("skz")).toBe("");
  disable(asEl(f));
  expect(f.attrs.size).toBe(0);
});

it("过期的 off 不会拆掉新一轮状态：关掉再开启后，旧 off 调用无效，新 off 才清干净", () => {
  const f = new FakeEl();
  const off1 = enable(asEl(f));
  off1();
  const off2 = enable(asEl(f));
  off1();
  expect(f.getAttribute("skz")).toBe("");
  expect(f.getAttribute("aria-busy")).toBe("true");
  off2();
  expect(f.attrs.size).toBe(0);
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

describe("无原生 inert：启用时让根内已聚焦的元素失焦", () => {
  /**
   * 造一个"已聚焦"的假元素：记录 blur 次数，closest 按是否在忽略区返回
   * @param root 根（作为父，contains 成立）
   * @param inIgnore 是否在忽略区内
   * @returns 假元素与 blur 计数
   */
  function focused(root: FakeEl, inIgnore: boolean): { el: FakeEl; blurred: () => number } {
    const el = root.add(new FakeEl());
    let n = 0;
    Object.assign(el, { blur: (): void => void n++, closest: (): FakeEl | null => (inIgnore ? el : null) });
    Object.assign(root, { contains: (x: FakeEl): boolean => x === root || root.children.includes(x) });
    vi.stubGlobal("document", { activeElement: el });
    return { el, blurred: () => n };
  }

  beforeEach(() => {
    // 撤掉 beforeEach 补的原型 inert：supportsInert 为假，走焦点拦截分支
    Reflect.deleteProperty(FakeEl.prototype, "inert");
  });

  it("根内已聚焦的元素启用后失焦", () => {
    const root = new FakeEl();
    const { blurred } = focused(root, false);
    const off = enable(asEl(root));
    expect(blurred()).toBe(1);
    off();
  });

  it("忽略区内已聚焦的元素不失焦；根外的聚焦元素也不动", () => {
    const root = new FakeEl();
    const { blurred } = focused(root, true);
    enable(asEl(root))();
    expect(blurred()).toBe(0);

    const other = new FakeEl();
    Object.assign(other, { contains: (): boolean => false });
    const outside = focused(new FakeEl(), false);
    enable(asEl(other))();
    expect(outside.blurred()).toBe(0);
  });
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

it("忽略区：enable 不再往根上写 skz-has-ignore（忽略区修正纯靠 skz-ignore 标记的 CSS），关闭后根上一个属性都不剩", () => {
  const root = new FakeEl();
  const ignore = root.add(new FakeEl());
  ignore.setAttribute("skz-ignore", "");
  const off = enable(asEl(root));
  expect(root.getAttribute("skz-has-ignore")).toBeNull();
  expect(root.attrs.size).toBe(2);
  expect(root.attrs.has("skz") && root.attrs.has("aria-busy")).toBe(true);

  root.children = [];
  enable(asEl(root));
  root.add(ignore);
  enable(asEl(root));
  off();
  expect(root.attrs.size).toBe(0);
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

describe("engine 扩展分两遍", () => {
  /**
   * 注册两个会记录调用顺序的假扩展（先 global 后 svg），返回新模块的 enable 和调用日志
   * @returns enable 与日志
   */
  async function withLoggedExtensions(): Promise<{ en: typeof enable; log: string[] }> {
    const { enable: en, registerEngine } = await loadFull();
    const log: string[] = [];
    for (const engine of ["global", "svg"] as const) {
      registerEngine({
        engine,
        sync: () => void log.push("sync:" + engine),
        release: () => void log.push("release:" + engine),
      });
    }
    return { en, log };
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
      getPropertyValue: (k: string): string => props.get(k) ?? "",
      getPropertyPriority: (): string => "",
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
