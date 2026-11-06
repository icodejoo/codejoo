import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import countdown, { clear as countdownClear, tick as countdownTick } from "./count-down/count-down";
import countup, { clear as countupClear, tick as countupTick } from "./count-up/count-up";
import GT, { use } from "./core";

describe("任务回调抛错隔离", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    countdownClear();
    countupClear();
    GT.destroy(); // rAF 被 stub 成永不回调，需重置核心的 raf 占位，免得污染后续用例
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("countdown：一个任务的 onUpdate 抛错不饿死同组兄弟", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    countdown(5000, a, {
      lazy: false,
      onUpdate: () => {
        throw new Error("boom");
      },
    });
    countdown(5000, b, { lazy: false });
    countdownTick();
    expect(b.textContent).toBe("00:00:05");
  });

  it("countdown：onDone 抛错仍出队，不会逐帧重复触发", () => {
    const el = document.createElement("div");
    const onDone = vi.fn(() => {
      throw new Error("boom");
    });
    countdown(1000, el, { lazy: false, onDone });
    vi.advanceTimersByTime(1500);
    countdownTick();
    countdownTick();
    countdownTick();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("countup：一个任务的 render 抛错不饿死兄弟；onDone 抛错仍出队", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const onDone = vi.fn(() => {
      throw new Error("boom");
    });
    let calls = 0;
    // 首次（add 时的同步初始渲染）放行，之后每帧都抛
    const render = () => {
      if (calls++ > 0) throw new Error("boom");
    };
    countup({ to: 10, duration: 100, el: a, lazy: false, render, onDone });
    countup({ to: 10, duration: 100, el: b, lazy: false });
    countupTick(0);
    countupTick(50);
    expect(b.textContent).not.toBe("");
    countupTick(200);
    countupTick(216);
    countupTick(232);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("核心调度：休眠与 tick 内入队", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.push(cb), frames.length));
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    GT.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const pump = (t: number) => {
    const cbs = frames;
    frames = [];
    cbs.forEach((cb) => cb(t));
  };

  it("插件返回正数 → 不排帧，改挂定时器，到点后再排一帧", () => {
    const spy = vi.fn((): number | boolean => 500);
    use({ name: "sleepy", install: spy });
    GT.start();
    pump(0);
    expect(frames.length).toBe(0);
    vi.advanceTimersByTime(499);
    expect(frames.length).toBe(0);
    vi.advanceTimersByTime(1);
    expect(frames.length).toBe(1);
    spy.mockReturnValue(false);
    pump(500);
    expect(frames.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("休眠期间 start() 取消定时器并立即排帧；stop() 清掉定时器", () => {
    use({ name: "sleepy2", install: () => 1000 });
    GT.start();
    pump(0);
    expect(vi.getTimerCount()).toBe(1);
    GT.start();
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.length).toBe(1);
    pump(16);
    GT.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("多插件：有人要逐帧则照常排帧，否则取最小唤醒时间", () => {
    use({ name: "slow", install: () => 800 });
    use({ name: "soon", install: () => 300 });
    GT.start();
    pump(0);
    vi.advanceTimersByTime(300);
    expect(frames.length).toBe(1);
    use({ name: "frame", install: () => true });
    pump(300);
    expect(frames.length).toBe(1); // 有逐帧插件，不休眠
  });

  it("tick 内新增任务（调用 start）：即使先跑的插件已报空闲，也不会丢帧", () => {
    let added = false;
    let late = false;
    use({ name: "early", install: () => late });
    use({
      name: "adder",
      install: () => {
        if (!added) {
          added = true;
          late = true;
          GT.start(); // 模拟 onDone 里新建任务
        }
        return false;
      },
    });
    GT.start();
    pump(0);
    expect(frames.length).toBe(1);
  });
});

describe("端到端：1 秒级倒计时不逐帧空转", () => {
  it("3 秒倒计时全程只排少量帧，仍按秒更新并准时完成", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    let rafCount = 0;
    let pending: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCount++;
      pending = cb;
      return rafCount;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const el = document.createElement("div");
    const seen: string[] = [];
    const onDone = vi.fn();
    countdown(3000, el, {
      lazy: false,
      onDone,
      render: (e, _r, _v, ctx) => {
        e.textContent = ctx!.fmt(_r, ctx!);
        seen.push(e.textContent);
      },
    });
    // 模拟浏览器：每 16ms 若有挂起的 rAF 就执行；timer 由 fake timers 推进
    for (let t = 0; t <= 3100; t += 16) {
      vi.advanceTimersByTime(16);
      const cb = pending;
      pending = undefined;
      cb?.(t);
    }
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["00:00:02", "00:00:01", "00:00:00", "00:00:00"]);
    expect(rafCount).toBeLessThan(15); // 之前约 190 帧
    GT.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
