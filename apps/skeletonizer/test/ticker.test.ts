import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** 最小假元素：属性表 + 内联样式 */
class FakeEl {
  /** 属性表 */
  attrs = new Map<string, string>();
  /** 内联自定义属性 */
  props = new Map<string, string>();
  /** setProperty 调用次数 */
  writes = 0;
  /** 内联样式的最小实现 */
  style = {
    setProperty: (k: string, v: string): void => {
      this.props.set(k, v);
      this.writes++;
    },
    removeProperty: (k: string): void => void this.props.delete(k),
  };
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
    return n === "style" ? (this.props.size ? "x" : "") : (this.attrs.get(n) ?? null);
  }
  /** @param n 属性名 */
  hasAttribute(n: string): boolean {
    return this.attrs.has(n);
  }
}

/** 把假元素当 HTMLElement 用 */
const asEl = (f: FakeEl): HTMLElement => f as unknown as HTMLElement;

/** 待执行的 rAF 回调 */
let queue: Array<(t: number) => void> = [];
/** 减少动态效果开关 */
let reduce = false;

/**
 * 推进一帧：执行当前排队的 rAF 回调。
 * @param t 时间戳
 */
const tick = (t: number): void => {
  const run = queue;
  queue = [];
  run.forEach((cb) => cb(t));
};

beforeEach(() => {
  queue = [];
  reduce = false;
  vi.resetModules();
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => queue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {
    queue = [];
  });
  vi.stubGlobal("CSS", { supports: () => true });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "1.5s" }));
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduce;
    },
  }));
  vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("按 fps 限速写入：间隔内的帧跳过，到点才写", async () => {
  const { startTick } = await import("../src/ticker.ts");
  const f = new FakeEl();
  startTick(asEl(f), "shimmer", 30);
  expect(f.attrs.has("skz-tick")).toBe(true);

  tick(100);
  const after1 = f.writes;
  expect(f.props.get("--skz-shimmer-p")).toBeDefined();
  tick(110);
  expect(f.writes).toBe(after1);
  tick(140);
  expect(f.writes).toBeGreaterThan(after1);
});

it("值没变就不写：脉冲在两端停留时不重复写", async () => {
  const { startTick } = await import("../src/ticker.ts");
  const f = new FakeEl();
  startTick(asEl(f), "pulse", 60);
  tick(0);
  tick(17);
  // 起点附近缓动很平，量化后进度仍是 0，只写过一次
  expect(f.writes).toBe(1);
  expect(f.props.get("--skz-pulse-t")).toBe("0");
  expect(f.props.has("--skz-shimmer-p")).toBe(false);
});

it("视口外的根不写；减少动态效果时整体不写", async () => {
  const { startTick } = await import("../src/ticker.ts");
  const f = new FakeEl();
  startTick(asEl(f), "shimmer", 30);
  f.setAttribute("skz-paused", "");
  tick(100);
  expect(f.writes).toBe(0);
  f.removeAttribute("skz-paused");
  reduce = true;
  tick(200);
  expect(f.writes).toBe(0);
  reduce = false;
  tick(300);
  expect(f.writes).toBeGreaterThan(0);
});

it("注销：清掉标记和变量，没有根时停掉循环", async () => {
  const { startTick, stopTick } = await import("../src/ticker.ts");
  const f = new FakeEl();
  startTick(asEl(f), "shimmer", 30);
  tick(100);
  stopTick(asEl(f));
  expect(f.attrs.has("skz-tick")).toBe(false);
  expect(f.props.size).toBe(0);
  expect(queue.length).toBe(0);
});

it("canTick：没有 rAF 或 CSS 不支持时返回 false", async () => {
  const { canTick } = await import("../src/ticker.ts");
  expect(canTick()).toBe(true);
  vi.stubGlobal("CSS", { supports: () => false });
  expect(canTick()).toBe(false);
});

it("自动档：写入后下一帧变慢就降档，连续流畅后升档", async () => {
  const { startTick } = await import("../src/ticker.ts");
  const f = new FakeEl();
  startTick(asEl(f), "shimmer", "auto");
  let t = 0;
  // 返回本帧是否写过（shimmer 一次写入会设两个变量，按帧统计）
  const step = (dt: number): number => {
    t += dt;
    const before = f.writes;
    tick(t);
    return f.writes > before ? 1 : 0;
  };
  step(16);
  // 每帧都写、且写后帧都慢（40ms）→ 档位升到每 4 帧写一次
  for (let i = 0; i < 40; i++) step(40);
  let writes = 0;
  for (let i = 0; i < 40; i++) writes += step(40);
  expect(writes).toBeLessThanOrEqual(10);
  // 之后一直流畅（10ms）→ 逐步升回每帧写
  for (let i = 0; i < 200; i++) step(10);
  writes = 0;
  for (let i = 0; i < 10; i++) writes += step(10);
  expect(writes).toBeGreaterThanOrEqual(9);
});
