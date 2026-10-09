import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** 最小假元素：属性表 + 子元素 */
class FakeEl {
  /** 属性表 */
  attrs = new Map<string, string>();
  /** 子元素 */
  children: FakeEl[] = [];
  /** @param n 属性名 @param v 属性值 */
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  /** @param n 属性名 */
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
  /** @param n 属性名 @param force 是否存在 */
  toggleAttribute(n: string, force: boolean): void {
    if (force) this.attrs.set(n, "");
    else this.attrs.delete(n);
  }
  /**
   * 追加 n 个子元素
   * @param n 个数
   * @returns 新加的子元素
   */
  add(n: number): FakeEl[] {
    const out = Array.from({ length: n }, () => new FakeEl());
    this.children.push(...out);
    return out;
  }
}

/** 把假元素当 HTMLElement 用 */
const asEl = (f: FakeEl): HTMLElement => f as unknown as HTMLElement;

/** 假的视口观察器 */
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
  vi.resetModules();
  vi.stubGlobal("IntersectionObserver", FakeIO);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("跳过只有一个子元素的包裹层，取列表项", async () => {
  const { firewallItems } = await import("../src/firewall.ts");
  const root = new FakeEl();
  const [list] = root.add(1);
  const cards = list!.add(5);
  expect(firewallItems(root as unknown as Element)).toEqual(cards);
});

it("项太少不启用", async () => {
  const { firewallItems } = await import("../src/firewall.ts");
  const root = new FakeEl();
  root.add(1)[0]!.add(1);
  expect(firewallItems(root as unknown as Element)).toEqual([]);
});

it("启用：先全部预打防火墙，视口内的由观察器撤掉，离开视口再打上", async () => {
  const { startFirewall } = await import("../src/firewall.ts");
  const root = new FakeEl();
  const cards = root.add(3);
  startFirewall(asEl(root));
  expect(cards.every((c) => c.attrs.has("skz-fw"))).toBe(true);
  const io = FakeIO.last!;
  expect(io.targets.size).toBe(3);

  io.cb([{ target: cards[0]!, isIntersecting: true }]);
  expect(cards[0]!.attrs.has("skz-fw")).toBe(false);
  io.cb([{ target: cards[0]!, isIntersecting: false }]);
  expect(cards[0]!.attrs.has("skz-fw")).toBe(true);
});

it("停用：取消观察并清掉标记；重复启用会重新扫描", async () => {
  const { startFirewall, stopFirewall } = await import("../src/firewall.ts");
  const root = new FakeEl();
  const cards = root.add(2);
  startFirewall(asEl(root));
  const more = root.add(1);
  startFirewall(asEl(root));
  expect(FakeIO.last!.targets.size).toBe(3);
  expect(more[0]!.attrs.has("skz-fw")).toBe(true);

  stopFirewall(asEl(root));
  expect(FakeIO.last!.targets.size).toBe(0);
  expect([...cards, ...more].some((c) => c.attrs.has("skz-fw"))).toBe(false);
});

it("没有 IntersectionObserver 时什么都不做", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { startFirewall } = await import("../src/firewall.ts");
  const root = new FakeEl();
  const cards = root.add(3);
  startFirewall(asEl(root));
  expect(cards.some((c) => c.attrs.has("skz-fw"))).toBe(false);
});
