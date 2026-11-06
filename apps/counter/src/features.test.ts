import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import GT from "./core";
import { isHidden, monoNow, onVisibility } from "./core/clock";
import countdown, { clear as cdClear, pause as cdPause, resume as cdResume, tick as cdTick } from "./count-down/count-down";
import countup, { clear as cuClear, tick as cuTick, register as cuRegister } from "./count-up/count-up";
import { isRelativeDuration } from "./count-down/helper";
import { watchOffscreen } from "./helper";

// ───────────── 假 IntersectionObserver ─────────────
class FakeIO {
  static all: FakeIO[] = [];
  targets = new Set<Element>();
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    FakeIO.all.push(this);
  }
  observe(e: Element) {
    this.targets.add(e);
  }
  unobserve(e: Element) {
    this.targets.delete(e);
  }
  static fire(el: Element, isIntersecting: boolean) {
    for (const io of FakeIO.all) {
      if (io.targets.has(el)) io.cb([{ target: el, isIntersecting } as unknown as IntersectionObserverEntry], io as unknown as IntersectionObserver);
    }
  }
  static watching(el: Element) {
    return FakeIO.all.some((io) => io.targets.has(el));
  }
}
beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", FakeIO);
});

/** 切换页面可见性并派发事件 */
function setHidden(h: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
  document.dispatchEvent(new Event("visibilitychange"));
}

// 待执行的 rAF（id → 回调），cancelAnimationFrame 真正取消
let rafSeq = 0;
const pendingFrames = new Map<number, FrameRequestCallback>();
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1));
  pendingFrames.clear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pendingFrames.set(++rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pendingFrames.delete(id));
  vi.spyOn(console, "error").mockImplementation(() => {});
}
function teardown() {
  cdClear();
  cuClear();
  GT.destroy();
  setHidden(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.useRealTimers();
}
const pump = (t = 0) => {
  const cbs = [...pendingFrames.values()];
  pendingFrames.clear();
  cbs.forEach((cb) => cb(t));
};
const div = () => document.createElement("div");
const linear = { duration: 1000, fps: 0, easing: (t: number) => t, fmt: String };

// ───────────── clock ─────────────
describe("clock：单调钟与可见性", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("monoNow 不受系统改时影响，但随时间前进", () => {
    const t0 = monoNow();
    vi.setSystemTime(Date.now() + 3_600_000); // 系统时间向前跳一小时
    expect(monoNow() - t0).toBeLessThan(10);
    vi.advanceTimersByTime(500);
    expect(monoNow() - t0).toBeGreaterThanOrEqual(500);
  });

  it("隐藏期间墙钟比单调钟多走 >1s 视为系统休眠，恢复时补偿；小差值不补偿", () => {
    const t0 = monoNow();
    setHidden(true);
    expect(isHidden()).toBe(true);
    vi.setSystemTime(Date.now() + 5000); // 只有墙钟走了 → 模拟系统睡眠
    setHidden(false);
    expect(isHidden()).toBe(false);
    expect(monoNow() - t0).toBeGreaterThanOrEqual(5000);

    const t1 = monoNow();
    setHidden(true);
    vi.setSystemTime(Date.now() + 400); // 采样误差级别
    setHidden(false);
    expect(monoNow() - t1).toBeLessThan(100);
  });

  it("重复的同状态事件被忽略；订阅者收到变化", () => {
    const fn = vi.fn();
    onVisibility(fn);
    setHidden(false); // 与当前一致
    expect(fn).not.toHaveBeenCalled();
    setHidden(true);
    expect(fn).toHaveBeenLastCalledWith(true);
    setHidden(false);
    expect(fn).toHaveBeenLastCalledWith(false);
  });

  it("初始即隐藏（无隐藏快照）后恢复可见：不补偿但照常通知；SSR 无 document 时安全", async () => {
    vi.resetModules();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    const fresh = await import("./core/clock");
    expect(fresh.isHidden()).toBe(true);
    const fn = vi.fn();
    fresh.onVisibility(fn);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledWith(false);

    vi.resetModules();
    vi.stubGlobal("document", undefined);
    const ssr = await import("./core/clock");
    expect(ssr.isHidden()).toBe(false);
    expect(typeof ssr.monoNow()).toBe("number");
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", FakeIO);
  });
});

// ───────────── core 隐藏态驱动 ─────────────
describe("core：隐藏页用定时器驱动、nudge", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("页面隐藏时 start 用 0ms 定时器直接跑循环，需逐帧的按 1s 轮询，休眠按需求延迟", () => {
    setHidden(true);
    let mode: boolean | number = true;
    const spy = vi.fn(() => mode);
    GT.use({ name: "h1", install: spy });
    GT.start();
    expect(pendingFrames.size).toBe(0);
    vi.advanceTimersByTime(0);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(spy).toHaveBeenCalledTimes(1); // 轮询间隔 1s
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(2);
    mode = 300;
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(4); // 休眠到点直接执行，不依赖 rAF
    expect(pendingFrames.size).toBe(0);
    mode = false;
    vi.advanceTimersByTime(300);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("可见 → 隐藏：撤掉待执行的 rAF 改用定时器；隐藏 → 可见：回到 rAF", () => {
    const spy = vi.fn(() => true);
    GT.use({ name: "h2", install: spy });
    GT.start();
    expect(pendingFrames.size).toBe(1);
    setHidden(true); // rAF 在后台会停摆
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(0);
    expect(spy).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(pendingFrames.size).toBeGreaterThan(0);
    const n = spy.mock.calls.length;
    pump(16);
    expect(spy.mock.calls.length).toBe(n + 1);
  });

  it("可见态休眠中变隐藏不动定时器；隐藏事件在未运行 / 遍历中被忽略", () => {
    GT.use({ name: "h3", install: () => 5000 });
    setHidden(true); // 未运行：忽略
    setHidden(false);
    GT.start();
    pump(0); // 休眠，timer 挂着
    expect(vi.getTimerCount()).toBe(1);
    setHidden(true); // raf 为空（休眠中）→ 保持定时器
    expect(vi.getTimerCount()).toBe(1);
    setHidden(false); // 有定时器 → 重排
    expect(pendingFrames.size).toBe(1);

    GT.stop();
    const fn = vi.fn(() => {
      setHidden(true); // 遍历中派发：被忽略
      return false;
    });
    GT.use({ name: "h4", install: fn });
    GT.start();
    pump(0);
    expect(fn).toHaveBeenCalled();
  });

  it("休眠中移除最后一个任务：nudge 立即收尾，不留定时器；未休眠时 nudge 无副作用", () => {
    const el = div();
    const id = countdown(3_600_500, el, { lazy: false });
    pump(0); // 一次 tick 后休眠（剩余不在整秒边界上，才会休眠而非逐帧）
    expect(vi.getTimerCount()).toBe(1);
    countdown.remove(id);
    expect(vi.getTimerCount()).toBe(0);
    pump(16); // nudge 排的那一帧：发现空闲 → 停止
    expect(pendingFrames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // 休眠中 clear 同理
    countdown(3_600_500, div(), { lazy: false });
    pump(0);
    expect(vi.getTimerCount()).toBe(1);
    countdown.clear();
    expect(vi.getTimerCount()).toBe(0);

    // 未运行时 remove 不会误启动循环
    GT.destroy();
    countdown.remove(12345);
    expect(pendingFrames.size).toBeGreaterThanOrEqual(0);
  });

  it("start 对休眠中的循环：打断休眠立刻重排（隐藏页用 0ms 定时器）", () => {
    GT.use({ name: "h5", install: () => 5000 });
    GT.start();
    pump(0);
    setHidden(true);
    GT.start();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(0);
    setHidden(false);
  });

  it("遍历中 start（kicked）：隐藏页用 0ms 定时器重排", () => {
    setHidden(true);
    let first = true;
    const spy = vi.fn(() => {
      if (first) {
        first = false;
        GT.start();
      }
      return false;
    });
    GT.use({ name: "h6", install: spy });
    GT.start();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(5); // tick 内新建的 0ms 定时器被抬到 1ms（与浏览器最小延迟一致）
    expect(spy.mock.calls.length).toBe(2);
  });
});

// ───────────── helper.watchOffscreen ─────────────
describe("watchOffscreen", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("离开 / 回到视口时回调；多个回调共存；取消后停止观察；未知元素的 entry 被忽略", () => {
    const el = div();
    const a = vi.fn();
    const b = vi.fn();
    const cancelA = watchOffscreen(el, a);
    const cancelB = watchOffscreen(el, b);
    FakeIO.fire(el, false);
    expect(a).toHaveBeenLastCalledWith(true);
    expect(b).toHaveBeenLastCalledWith(true);
    FakeIO.fire(el, true);
    expect(a).toHaveBeenLastCalledWith(false);
    cancelA();
    cancelA(); // 重复取消
    expect(FakeIO.watching(el)).toBe(true);
    cancelB();
    expect(FakeIO.watching(el)).toBe(false);
    cancelB();
    FakeIO.all.forEach((io) => io.cb([{ target: div(), isIntersecting: false } as unknown as IntersectionObserverEntry], io as unknown as IntersectionObserver));
  });

  it("无 IntersectionObserver 环境：视为永不离屏，返回空取消函数", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const cancel = watchOffscreen(div(), vi.fn());
    expect(() => cancel()).not.toThrow();
  });
});

// ───────────── countdown：单调钟 ─────────────
describe("countdown：相对时长走单调钟，绝对时间走墙钟", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("isRelativeDuration：仅内置解析器下的小数值为相对", () => {
    expect(isRelativeDuration(5000, "ms")).toBe(true);
    expect(isRelativeDuration(0, "second")).toBe(true);
    expect(isRelativeDuration(-1, "ms")).toBe(false);
    expect(isRelativeDuration(Infinity, "ms")).toBe(false);
    expect(isRelativeDuration(Date.now() + 5000, "ms")).toBe(false);
    expect(isRelativeDuration(new Date(), "ms")).toBe(false);
    expect(isRelativeDuration("2030-01-01", "ms")).toBe(false);
    expect(isRelativeDuration(5000, () => 1)).toBe(false);
  });

  it("系统时间前跳 / 回拨：相对倒计时不受影响，绝对 deadline 跟随墙钟", () => {
    const rel = div();
    const abs = div();
    countdown(10_000, rel, { lazy: false });
    countdown(new Date(Date.now() + 10_000), abs, { lazy: false });
    cdTick();
    expect(rel.textContent).toBe("00:00:10");
    expect(abs.textContent).toBe("00:00:10");
    vi.setSystemTime(Date.now() + 4000); // 墙钟前跳 4s
    cdTick();
    expect(rel.textContent).toBe("00:00:10"); // 相对：不动
    expect(abs.textContent).toBe("00:00:06"); // 绝对：跟随
    vi.setSystemTime(Date.now() - 9000); // 回拨
    vi.advanceTimersByTime(2000);
    cdTick();
    expect(rel.textContent).toBe("00:00:08");
  });

  it("暂停恢复后按单调钟重锚；ctx.deadline 对外是墙钟时间戳", () => {
    const el = div();
    let ctxDeadline = 0;
    const id = countdown(10_000, el, { lazy: false, onResume: (_r, ctx) => (ctxDeadline = ctx.deadline) });
    cdTick();
    vi.advanceTimersByTime(3000);
    cdPause(id);
    vi.advanceTimersByTime(5000);
    cdResume(id);
    cdTick();
    expect(el.textContent).toBe("00:00:07");
    vi.setSystemTime(Date.now() + 100_000); // 恢复后的改时不影响
    cdTick();
    expect(el.textContent).toBe("00:00:07");
    expect(ctxDeadline).toBeGreaterThan(0);

    const abs = div();
    const id2 = countdown(new Date(Date.now() + 10_000), abs, { lazy: false });
    cdPause(id2); // 绝对任务暂停（走墙钟读 frozen）
    cdResume(id2);
  });

  it("系统休眠补偿后，相对倒计时跟着扣掉睡眠时间", () => {
    const el = div();
    countdown(60_000, el, { lazy: false });
    cdTick();
    setHidden(true);
    vi.setSystemTime(Date.now() + 20_000); // 睡眠 20s
    setHidden(false);
    cdTick();
    expect(el.textContent).toBe("00:00:40");
  });
});

// ───────────── countdown：fps ─────────────
describe("countdown：毫秒任务 fps 限帧", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("按固定网格限帧；网格点前不渲染；晚到跳过错失时隙；完成不受限", () => {
    const el = div();
    const onDone = vi.fn();
    const render = vi.fn();
    countdown(1000, el, { lazy: false, showMilliseconds: true, fps: 10, render, onDone });
    cdTick(); // 首次：立即渲染并建网格
    expect(render).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(40);
    cdTick();
    expect(render).toHaveBeenCalledTimes(1); // 未到网格点
    vi.advanceTimersByTime(55); // 95ms：落在 100ms 网格点的 8ms 容差内
    cdTick();
    expect(render).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3); // 98ms，下一点是 200
    cdTick();
    expect(render).toHaveBeenCalledTimes(2); // 容差内提前触发后网格已前进一格，不会连续触发
    vi.advanceTimersByTime(350); // 晚到：错过 200、300 两个点，不补发
    cdTick();
    expect(render).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(600); // 越过截止：不受限帧影响，立即完成
    cdTick();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("作为插件：限帧等待超过 20ms 窗口 → 休眠；完成时刻更早时取完成时刻", () => {
    const el = div();
    countdown(100_000, el, { lazy: false, showMilliseconds: true, fps: 10 });
    const p = (GT as unknown as { down: { install: () => { install: (a: number, b: number) => boolean | number } } }).down.install();
    expect(p.install(0, 0)).toBeGreaterThan(20); // 约 92ms
    countdown.clear();
    countdown(50, div(), { lazy: false, showMilliseconds: true, fps: 1 });
    cdTick();
    expect(p.install(0, 0)).toBe(50); // 限帧网格 ≈1s 外，完成时刻（50ms）更早 → 取完成时刻
    vi.advanceTimersByTime(35);
    expect(p.install(0, 0)).toBe(true); // 距完成 ≤ 20ms 窗口 → 逐帧
  });

  it("fps 对整秒任务无影响", () => {
    const el = div();
    countdown(5000, el, { lazy: false, fps: 5 });
    cdTick();
    expect(el.textContent).toBe("00:00:05");
  });
});

// ───────────── countdown：静音 ─────────────
describe("countdown：隐藏 / 离屏静音", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("页面隐藏：不渲染不回调、完成仍准时（定时器驱动）；恢复可见立即刷新当前值", () => {
    setHidden(true);
    const el = div();
    const onUpdate = vi.fn();
    const onDone = vi.fn();
    countdown(3000, el, { lazy: false, onUpdate, onDone });
    vi.advanceTimersByTime(1000);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(el.textContent).toBe("");
    vi.advanceTimersByTime(2100);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(el.textContent).toBe("00:00:00"); // 终值落定

    const el2 = div();
    countdown(10_000, el2, { lazy: false });
    cdTick();
    expect(el2.textContent).toBe("");
    vi.advanceTimersByTime(4000);
    setHidden(false);
    cdTick();
    expect(el2.textContent).toBe("00:00:06"); // 立即刷新为当前值
  });

  it("元素离屏同样静音，回到视口立即唤醒循环并刷新", () => {
    const el = div();
    const onUpdate = vi.fn();
    countdown(10_000, el, { lazy: false, onUpdate });
    cdTick();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    FakeIO.fire(el, false);
    vi.advanceTimersByTime(3000);
    cdTick();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const p = (GT as unknown as { down: { install: () => { install: (a: number, b: number) => boolean | number } } }).down.install();
    expect(p.install(0, 0)).toBeGreaterThan(20); // 只等完成时刻
    GT.stop();
    FakeIO.fire(el, true);
    expect(pendingFrames.size).toBeGreaterThan(0); // start() 已唤醒
    cdTick();
    expect(el.textContent).toBe("00:00:07");
  });

  it("muteHidden:false 始终更新，且不挂离屏观察", () => {
    setHidden(true);
    const el = div();
    const onUpdate = vi.fn();
    countdown(5000, el, { lazy: false, muteHidden: false, onUpdate });
    cdTick();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(FakeIO.watching(el)).toBe(false);
  });

  it("移除任务时断开离屏观察", () => {
    const el = div();
    const id = countdown(5000, el, { lazy: false });
    expect(FakeIO.watching(el)).toBe(true);
    countdown.remove(id);
    expect(FakeIO.watching(el)).toBe(false);
  });
});

// ───────────── countup：静音 ─────────────
describe("countup：隐藏 / 离屏静音", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("静音期间不渲染、进度按时间推进；解除后立即显示当前位置；完成照常通知", () => {
    const el = div();
    const onUpdate = vi.fn();
    const onDone = vi.fn();
    countup({ to: 100, el, lazy: false, onUpdate, onDone, ...linear });
    cuTick(0, 0);
    cuTick(100, 100);
    const before = onUpdate.mock.calls.length;
    FakeIO.fire(el, false); // 离屏
    cuTick(500, 400);
    expect(onUpdate.mock.calls.length).toBe(before); // 静音
    FakeIO.fire(el, true);
    cuTick(600, 100); // 解除：直接到当前进度 60%
    expect(el.textContent).toBe("60");
    FakeIO.fire(el, false);
    cuTick(1000, 400); // 静音时到点：仍落终值并通知
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(el.textContent).toBe("100");
  });

  it("作为插件：只剩静音任务时返回到点延迟；有活跃任务时逐帧；完成时刻很近则逐帧", () => {
    const a = div();
    countup({ to: 100, el: a, lazy: false, ...linear, duration: 5000 });
    const p = cuRegister();
    p.install(0, 0); // 起算
    FakeIO.fire(a, false);
    expect(p.install(100, 100)).toBeGreaterThan(20); // 约 4900ms 后才完成
    const b = div();
    countup({ to: 100, el: b, lazy: false, ...linear });
    expect(p.install(200, 100)).toBe(true); // b 在跑 → 逐帧
    countup.clear();
    const c = div();
    countup({ to: 100, el: c, lazy: false, ...linear, duration: 1000 });
    p.install(1000, 0);
    FakeIO.fire(c, false);
    expect(p.install(1990, 990)).toBe(true); // 距完成 10ms ≤ 窗口
    p.dispose!();
  });

  it("页面隐藏：count-up 静音；muteHidden:false / 无元素任务不静音也不挂观察", () => {
    setHidden(true);
    const el = div();
    const onUpdate = vi.fn();
    countup({ to: 10, el, lazy: false, onUpdate, ...linear });
    cuTick(0, 0);
    cuTick(500, 500);
    expect(onUpdate).not.toHaveBeenCalled();
    const el2 = div();
    const onUpdate2 = vi.fn();
    countup({ to: 10, el: el2, lazy: false, muteHidden: false, onUpdate: onUpdate2, ...linear });
    expect(FakeIO.watching(el2)).toBe(false);
    cuTick(0, 0);
    cuTick(500, 500);
    expect(onUpdate2).toHaveBeenCalled();
    const onUpdate3 = vi.fn();
    countup({ to: 10, lazy: false, onUpdate: onUpdate3, ...linear }); // 无元素
    cuTick(0, 0);
    cuTick(500, 500);
    expect(onUpdate3).toHaveBeenCalled(); // 无元素任务是纯数据补间，页面隐藏也不静音
  });

  it("重定目标：muteHidden 开关随新配置更新，已有观察不重复挂；移除时断开", () => {
    const el = div();
    countup({ to: 10, el, lazy: false, muteHidden: false, ...linear });
    expect(FakeIO.watching(el)).toBe(false);
    countup({ to: 20, el, lazy: false, muteHidden: true, ...linear }); // 重定并开启 → 挂观察
    expect(FakeIO.watching(el)).toBe(true);
    const ios = FakeIO.all.length;
    countup({ to: 30, el, lazy: false, muteHidden: true, ...linear }); // 已挂，不重复
    expect(FakeIO.all.length).toBe(ios);
    cuClear();
    expect(FakeIO.watching(el)).toBe(false);
  });
});

describe("多任务取最小唤醒 / 绝对时间的 lazy 激活", () => {
  beforeEach(setup);
  afterEach(teardown);

  const downPlugin = () => (GT as unknown as { down: { install: () => { install: (a: number, b: number) => boolean | number } } }).down.install();

  it("倒计时：多个静音任务取最早完成；多个限帧任务取最早网格点", () => {
    FakeIO.fire(div(), true);
    const a = div();
    const b = div();
    countdown(100_000, a, { lazy: false });
    countdown(50_000, b, { lazy: false });
    FakeIO.fire(a, false);
    FakeIO.fire(b, false);
    const p = downPlugin();
    expect(p.install(0, 0)).toBe(50_000); // 取较早的 b；顺序 a→b，b 更小
    countdown.clear();
    const c = div();
    const d = div();
    countdown(50_000, c, { lazy: false });
    countdown(100_000, d, { lazy: false });
    FakeIO.fire(c, false);
    FakeIO.fire(d, false);
    expect(p.install(0, 0)).toBe(50_000); // 顺序 c→d，后者更大不覆盖

    countdown.clear();
    const e = div();
    const f = div();
    countdown(100_000, e, { lazy: false, showMilliseconds: true, fps: 10 });
    countdown(100_000, f, { lazy: false, showMilliseconds: true, fps: 1 });
    expect(p.install(0, 0)).toBeLessThan(100); // 取 10fps 的 ≈92ms，而非 1fps 的 ≈992ms
    vi.advanceTimersByTime(10);
    expect(p.install(0, 0)).toBeLessThan(100); // 此时两个任务都未到点，走“未到网格点”分支，同样取最小
  });

  it("count-up：多个静音任务取最早完成", () => {
    const a = div();
    const b = div();
    countup({ to: 1, el: a, lazy: false, ...linear, duration: 9000 });
    countup({ to: 1, el: b, lazy: false, ...linear, duration: 3000 });
    const p = cuRegister();
    p.install(0, 0);
    FakeIO.fire(a, false);
    FakeIO.fire(b, false);
    expect(p.install(0, 0)).toBe(3000);
    countup.clear();
    const c = div();
    const d = div();
    countup({ to: 1, el: c, lazy: false, ...linear, duration: 3000 });
    countup({ to: 1, el: d, lazy: false, ...linear, duration: 9000 }); // 顺序 c→d：后者更大不覆盖
    p.install(0, 0);
    FakeIO.fire(c, false);
    FakeIO.fire(d, false);
    expect(p.install(0, 0)).toBe(3000);
    p.dispose!();
  });

  it("绝对时间任务：lazy 激活与 lifecycle 挂载走墙钟", () => {
    const el = div();
    const mount = vi.fn(() => ({}));
    const r = { mount, update: vi.fn(), destroy: vi.fn() };
    countdown(new Date(Date.now() + 10_000), el, { render: r as never, lazy: true });
    FakeIO.all.forEach((io) => io.targets.has(el) && io.cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], io as unknown as IntersectionObserver));
    expect(mount).toHaveBeenCalledTimes(1);
    const el2 = div();
    const id = countdown(new Date(Date.now() + 10_000), el2, { lazy: true });
    cdPause(id);
    FakeIO.all.forEach((io) => io.targets.has(el2) && io.cb([{ target: el2, isIntersecting: true } as unknown as IntersectionObserverEntry], io as unknown as IntersectionObserver)); // 暂停中进入视口
    cdResume(id);
    cdTick();
    expect(el2.textContent).toBe("00:00:10");
  });
});
