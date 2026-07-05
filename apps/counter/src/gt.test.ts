import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GT, use } from "./core";
import countdown, { tick as countdownTick } from "./count-down/count-down";
import countup, { tick as countupTick } from "./count-up/count-up";
import { buildDateParser, buildHighPerfFormatter } from "./count-down/helper";

describe("buildHighPerfFormatter", () => {
  it("formats HH:mm:ss with total hours by default", () => {
    const fmt = buildHighPerfFormatter("HH:mm:ss");
    expect(fmt(90061000)).toBe("25:01:01");
  });

  it("splits days when showDays is true", () => {
    const fmt = buildHighPerfFormatter("DD天 HH:mm:ss", { showDays: true, showMs: false });
    expect(fmt(90061000)).toBe("01天 01:01:01");
  });

  it("renders padded milliseconds when showMs is true", () => {
    const fmt = buildHighPerfFormatter("mm:ss.sss", { showDays: false, showMs: true });
    expect(fmt(61500)).toBe("01:01.500");
    expect(fmt(61005)).toBe("01:01.005");
  });

  it("escapes quotes and backslashes in literal parts", () => {
    const fmt = buildHighPerfFormatter('ss"q\\');
    expect(fmt(5000)).toBe('05"q\\');
  });
});

describe("buildDateParser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
  });
  afterEach(() => vi.useRealTimers());

  it("parses date-only strings", () => {
    expect(buildDateParser("ms")("2026-06-13")).toBe(new Date(2026, 5, 13).getTime());
  });

  it("parses datetime strings without milliseconds", () => {
    expect(buildDateParser("ms")("2026-06-13 10:30:00")).toBe(new Date(2026, 5, 13, 10, 30, 0).getTime());
  });

  it("treats small numbers as durations anchored to now", () => {
    expect(buildDateParser("second")(3)).toBe(Date.now() + 3000);
  });

  it("applies timeOffset to absolute times but not durations", () => {
    const deadline = new Date(2026, 5, 13);
    expect(buildDateParser("ms")(deadline, 5000)).toBe(deadline.getTime() - 5000);
    expect(buildDateParser("second")(3, 5000)).toBe(Date.now() + 3000);
  });

  it("throws on invalid input", () => {
    expect(() => buildDateParser("ms")("not a date")).toThrow("[GT]");
    expect(() => buildDateParser("ms")(NaN)).toThrow("[GT]");
  });
});

describe("core scheduler", () => {
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  function pump(t: number) {
    const cbs = frames;
    frames = [];
    cbs.forEach((cb) => cb(t));
  }

  it("keeps looping while plugins are busy and stops when all idle", () => {
    let busy = true;
    const spy = vi.fn(() => busy);
    use({ name: "spin", install: spy });
    GT.start();
    expect(frames.length).toBe(1);
    pump(100);
    expect(spy).toHaveBeenLastCalledWith(100, 0);
    expect(frames.length).toBe(1); // busy → 继续排帧
    busy = false;
    pump(116);
    expect(spy).toHaveBeenLastCalledWith(116, 16);
    expect(frames.length).toBe(0); // 全部空闲 → 自动停止
  });

  it("dedupes plugins by name and mounts api", () => {
    const spy = vi.fn(() => false);
    use({ name: "dedupe", install: spy, api: "api-1" });
    use({ name: "dedupe", install: vi.fn(), api: "api-2" });
    expect((GT as any).dedupe).toBe("api-1");
    GT.start();
    pump(10);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    countdown.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders remaining time, fires onDone once and removes the task", () => {
    const el = document.createElement("div");
    const onDone = vi.fn();
    countdown(3000, el, { onDone });

    expect(countdownTick()).toBe(true);
    expect(el.textContent).toBe("00:00:03");

    vi.setSystemTime(Date.now() + 1000);
    countdownTick();
    expect(el.textContent).toBe("00:00:02");

    vi.setSystemTime(Date.now() + 2000);
    expect(countdownTick()).toBe(false);
    expect(el.textContent).toBe("00:00:00");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(0, expect.anything()); // 第二参为 ctx

    // 任务已出队：再 tick 不会重复触发
    countdownTick();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("autoKill:false keeps the task at zero; onDone once, no re-render", () => {
    const el = document.createElement("div");
    const onDone = vi.fn();
    const render = vi.fn();
    countdown(2000, el, { autoKill: false, onDone, render });
    countdownTick();
    vi.setSystemTime(Date.now() + 2000);
    expect(countdownTick()).toBe(false); // 归零但保留，不计 busy
    expect(onDone).toHaveBeenCalledTimes(1);
    const calls = render.mock.calls.length;
    vi.setSystemTime(Date.now() + 1000);
    countdownTick(); // done → 跳过
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(render.mock.calls.length).toBe(calls);
  });

  it("calls the render's destroy() on auto-kill and on manual remove", () => {
    const el = document.createElement("div");
    const destroy = vi.fn();
    countdown(1000, el, { render: Object.assign(vi.fn(), { destroy }) });
    countdownTick();
    vi.setSystemTime(Date.now() + 1000);
    countdownTick(); // 归零 → autoKill 出队 → destroy(el)
    expect(destroy).toHaveBeenCalledWith(el);

    const el2 = document.createElement("div");
    const destroy2 = vi.fn();
    const id2 = countdown(5000, el2, { render: Object.assign(vi.fn(), { destroy: destroy2 }) });
    countdown.remove(id2); // 手动终止某个任务 → 同样 destroy
    expect(destroy2).toHaveBeenCalledWith(el2);
  });

  it("skips re-render within the same second", () => {
    const el = document.createElement("div");
    const render = vi.fn();
    countdown(5000, el, { render });
    countdownTick(); // remaining 5000 → 渲染 "05"
    vi.setSystemTime(Date.now() + 300);
    countdownTick(); // remaining 4700，秒位 5→4 → 渲染 "04"
    expect(render).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 300);
    countdownTick(); // remaining 4400，仍是 "04" → 跳过
    expect(render).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 500);
    countdownTick(); // remaining 3900，秒位 4→3 → 渲染
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("ctx.oldValue holds the previous rendered value, unchanged on skipped renders", () => {
    const el = document.createElement("div");
    const snapshots: { value: number[]; oldValue: number[] }[] = [];
    const render = vi.fn((_el: Element, _remaining: number, value: readonly number[], ctx: { oldValue: readonly number[] }) => {
      snapshots.push({ value: [...value], oldValue: [...ctx.oldValue] });
    });
    countdown(5000, el, { render });

    countdownTick(); // remaining 5000 → value=[...,5,0], oldValue = 初始快照 [...,0,0]
    expect(snapshots[0].value).toEqual([0, 0, 0, 5, 0]);
    expect(snapshots[0].oldValue).toEqual([0, 0, 0, 0, 0]);

    vi.setSystemTime(Date.now() + 300);
    countdownTick(); // 秒位 5→4 → 渲染，oldValue 应为上一次渲染的 value
    expect(snapshots[1].value).toEqual([0, 0, 0, 4, 700]);
    expect(snapshots[1].oldValue).toEqual([0, 0, 0, 5, 0]);

    vi.setSystemTime(Date.now() + 300);
    countdownTick(); // 仍是同一秒 → 跳过渲染，oldValue 不应刷新
    expect(snapshots.length).toBe(2);
  });

  it("removes a task by id in O(1) without touching others", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const idA = countdown(5000, a);
    countdown(5000, b);
    countdown.remove(idA);
    vi.setSystemTime(Date.now() + 1100);
    countdownTick();
    expect(a.textContent).toBe("");
    expect(b.textContent).toBe("00:00:03");
  });

  it("lazyTimeout does not recycle an already-activated task under jsdom (no IntersectionObserver)", () => {
    const el = document.createElement("div");
    const onDone = vi.fn();
    countdown(5000, el, { lazyTimeout: 1000, onDone }); // jsdom 无 IntersectionObserver → lazyStart 同步激活
    countdownTick();
    expect(el.textContent).toBe("00:00:05");
    vi.advanceTimersByTime(1000); // 若旧超时器未被拦截，会在此触发误回收
    countdownTick();
    expect(onDone).not.toHaveBeenCalled();
    expect(el.textContent).not.toBe("");
  });

  it("onStart fires once before onDone even when the first eligible tick is already at/after the deadline", () => {
    const el = document.createElement("div");
    const order: string[] = [];
    const onStart = vi.fn(() => order.push("start"));
    const onDone = vi.fn(() => order.push("done"));
    countdown(1000, el, { lazy: false, onStart, onDone });
    vi.setSystemTime(Date.now() + 2000); // 首次 tick 时已过期
    countdownTick();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["start", "done"]);
  });

  it("activating a lazy task while it is still paused defers the deadline anchor to resume() (no instant-finish)", () => {
    let observerInstance: { trigger: (el: Element) => void } | undefined;
    class FakeIntersectionObserver {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        observerInstance = this as unknown as { trigger: (el: Element) => void };
      }
      observe() {}
      unobserve() {}
      trigger(el: Element) {
        this.cb([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    const el = document.createElement("div");
    const onDone = vi.fn();
    const id = countdown(10000, el, { lazy: true, onDone }); // 尚未进入视口
    countdown.pause(id); // 可见前先暂停
    observerInstance!.trigger(el); // 进入视口（此时仍处于暂停）
    countdown.resume(id); // 恢复：应按满时长重新起算，而非瞬间到期
    countdownTick();
    expect(onDone).not.toHaveBeenCalled();
    expect(el.textContent).toBe("00:00:10");
  });

  it("clear fires onDestroy with current remaining", () => {
    const el = document.createElement("div");
    const onDestroy = vi.fn();
    countdown(3000, el, { onDestroy });
    countdown.clear();
    expect(onDestroy).toHaveBeenCalledWith(3000, expect.anything()); // 第二参为 ctx
    expect(countdownTick()).toBe(false);
  });
});

describe("countup", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    countup.clear();
    vi.unstubAllGlobals();
  });

  const linear = { duration: 1000, fps: 0, easing: (t: number) => t, fmt: String };

  it("animates from 'from' to 'to' and fires onDone once", () => {
    const el = document.createElement("div");
    const onDone = vi.fn();
    countup({ to: 100, el, onDone, ...linear });

    expect(countupTick(0, 0)).toBe(true);
    expect(el.textContent).toBe("0");
    countupTick(500, 500);
    expect(el.textContent).toBe("50");
    expect(countupTick(1000, 500)).toBe(false);
    expect(el.textContent).toBe("100");
    expect(onDone).toHaveBeenCalledTimes(1);
    countupTick(1100, 100);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("autoKill:false keeps the task at target; onDone once, no re-tick", () => {
    const el = document.createElement("div");
    const onDone = vi.fn();
    countup({ to: 100, el, onDone, autoKill: false, ...linear });
    countupTick(0, 0);
    expect(countupTick(1000, 1000)).toBe(false); // 到达目标但保留，不计 busy
    expect(el.textContent).toBe("100");
    expect(onDone).toHaveBeenCalledTimes(1);
    countupTick(1100, 100); // done → 跳过
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls the render's destroy() on auto-kill and on manual remove", () => {
    const el = document.createElement("div");
    const destroy = vi.fn();
    countup({ to: 10, el, ...linear, render: Object.assign(vi.fn(), { destroy }) });
    countupTick(0, 0);
    countupTick(1000, 1000); // 完成 → autoKill 出队 → destroy(el)
    expect(destroy).toHaveBeenCalledWith(el);

    const el2 = document.createElement("div");
    const destroy2 = vi.fn();
    const id2 = countup({ to: 10, el: el2, ...linear, render: Object.assign(vi.fn(), { destroy: destroy2 }) });
    countup.remove(id2); // 手动终止某个任务 → 同样 destroy
    expect(destroy2).toHaveBeenCalledWith(el2);
  });

  it("pause() then resume() before the task's first tick does not snap the animation to completion", () => {
    countupTick(1000, 1000); // 把模块级 lastElapsed 推进到"晚于任务创建时刻"，模拟 ticker 早已运行多帧
    const el = document.createElement("div");
    const onDone = vi.fn();
    const onStart = vi.fn();
    const id = countup({ to: 100, el, onDone, onStart, ...linear }); // 创建后尚未被 tick 过，startAt 仍是哨兵值 -1
    countup.pause(id);
    countup.resume(id);
    countupTick(1050, 50);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(el.textContent).not.toBe("100");
  });

  it("retargeting in place releases the previous renderer via destroy() before swapping in the new one", () => {
    const el = document.createElement("div");
    const destroyOld = vi.fn();
    const renderOld = Object.assign(vi.fn(), { destroy: destroyOld });
    const renderNew = vi.fn();
    countup({ to: 10, el, ...linear, render: renderOld });
    countupTick(0, 0);
    countup({ to: 20, el, ...linear, render: renderNew }); // 同元素原地重定，且换了渲染器
    expect(destroyOld).toHaveBeenCalledWith(el);
    countupTick(500, 500);
    expect(renderNew).toHaveBeenCalled();
  });

  it("throttles updates by fps without phase drift", () => {
    const el = document.createElement("div");
    const onUpdate = vi.fn();
    countup({ to: 100, el, onUpdate, ...linear, fps: 50 }); // interval = 20ms
    countupTick(0, 0); // accum 0 < 20 → 跳过
    expect(onUpdate).toHaveBeenCalledTimes(0);
    countupTick(20, 20); // accum 20 ≥ 20 → 更新
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("removes a task by id in O(1)", () => {
    const el = document.createElement("div");
    const id = countup({ to: 100, el, ...linear });
    countup.remove(id);
    expect(countupTick(0, 0)).toBe(false);
    expect(el.textContent).toBe("");
  });

  it("supports positional overloads and returns task ids", () => {
    const onDone = vi.fn();
    const id1 = countup(100);
    const id2 = countup(0, 100, "lbl");
    expect(id2).toBe(id1 + 1);
    countup.clear("lbl");
    countup.clear();
    expect(countupTick(0, 0)).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("retargets in place (no extra task) when called again on the same element", () => {
    const el = document.createElement("div");
    const id1 = countup({ to: 100, el, ...linear });
    countupTick(0, 0);
    countupTick(500, 500);
    expect(el.textContent).toBe("50"); // 动画到一半，当前值 50

    // 中途改目标：同元素 → 原地重定目标，返回同一 id（未新建任务）
    const id2 = countup({ to: 60, el, ...linear });
    expect(id2).toBe(id1);

    // 从当前值 50 丝滑续接到新目标 60（不跳回 0）
    expect(countupTick(600, 100)).toBe(true);
    expect(el.textContent).toBe("50"); // 重定后首帧仍是起点 50
    countupTick(1100, 500); // 续接 0.5 进度：50 + (60-50)*0.5 = 55
    expect(el.textContent).toBe("55");
    expect(countupTick(1600, 500)).toBe(false); // 落定到 60
    expect(el.textContent).toBe("60");
  });

  it("retarget honours an explicit from (overrides current value)", () => {
    const el = document.createElement("div");
    countup({ to: 100, el, ...linear });
    countupTick(0, 0);
    countupTick(500, 500); // 当前值 50
    countup({ from: 0, to: 80, el, ...linear }); // 显式 from=0 → 从 0 起
    countupTick(600, 100);
    expect(el.textContent).toBe("0");
  });

  it("retargets down to a smaller target from the current value (no from)", () => {
    const el = document.createElement("div");
    countup({ to: 100, el, ...linear });
    countupTick(0, 0);
    countupTick(500, 500); // 当前值 50
    countup({ to: 10, el, ...linear }); // 减小目标，未传 from → 从 50 起
    countupTick(600, 100);
    expect(el.textContent).toBe("50"); // 不跳回 0
    countupTick(1100, 500); // 50 + (10-50)*0.5 = 30
    expect(el.textContent).toBe("30");
    expect(countupTick(1600, 500)).toBe(false);
    expect(el.textContent).toBe("10");
  });

  it("does not create a duplicate task on retarget (exactly one task remains)", () => {
    const el = document.createElement("div");
    const id = countup({ to: 100, el, ...linear });
    countupTick(0, 0);
    countupTick(500, 500);
    countup({ to: 60, el, ...linear }); // 重定（同 id）
    countup.remove(id); // 移除唯一任务
    expect(countupTick(600, 100)).toBe(false); // 无任务在跑 → 证明没有第二个竞争任务
  });

  it("retarget resets timing and applies the new duration/easing", () => {
    const el = document.createElement("div");
    countup({ to: 100, el, ...linear }); // duration 1000
    countupTick(0, 0);
    countupTick(500, 500); // 当前值 50
    // 重定且换更短 duration：计时从重定那刻重新开始
    countup({ to: 60, el, duration: 200, fps: 0, easing: (t: number) => t, fmt: String });
    countupTick(700, 200); // 首帧 → startAt=700, progress 0
    expect(el.textContent).toBe("50");
    countupTick(800, 100); // progress=(800-700)/200=0.5 → 55
    expect(el.textContent).toBe("55");
    expect(countupTick(900, 100)).toBe(false); // progress=1 → 60（200ms 内完成）
    expect(el.textContent).toBe("60");
  });

  it("continues from the last finished value when count-up is called again after done", () => {
    const el = document.createElement("div");
    const id1 = countup({ to: 100, el, ...linear });
    countupTick(0, 0);
    expect(countupTick(1000, 1000)).toBe(false); // 完成于 100 → 任务出队
    expect(el.textContent).toBe("100");
    const id2 = countup({ to: 50, el, ...linear }); // 结束后再调：新任务，但从末值 100 续接
    expect(id2).not.toBe(id1); // 旧任务已出队 → 新 id
    countupTick(1100, 100);
    expect(el.textContent).toBe("100"); // 不跳回 0
    countupTick(1600, 500); // 100 + (50-100)*0.5 = 75
    expect(el.textContent).toBe("75");
    expect(countupTick(2100, 500)).toBe(false);
    expect(el.textContent).toBe("50");
  });

  it("explicit from overrides last-value continuation after done", () => {
    const el = document.createElement("div");
    countup({ to: 100, el, ...linear });
    countupTick(0, 0);
    countupTick(1000, 1000); // 完成于 100
    countup({ from: 0, to: 50, el, ...linear }); // 显式 from:0 → 忽略末值，从 0 起
    countupTick(1100, 100);
    expect(el.textContent).toBe("0");
  });

  it("clear() during animation records the displayed value for seamless continuation", () => {
    const el = document.createElement("div");
    countup({ to: 100, el, ...linear });
    countupTick(0, 0);
    countupTick(500, 500); // 当前显示 50
    countup.clear(); // 取消但记录当前值 50
    countup({ to: 80, el, ...linear }); // 再起 → 从显示值 50 续接（无跳变）
    countupTick(600, 100);
    expect(el.textContent).toBe("50");
    countupTick(1100, 500); // 50 + (80-50)*0.5 = 65
    expect(el.textContent).toBe("65");
  });

  it("retargets by element across label groups (label mismatch still hits)", () => {
    const el = document.createElement("div");
    const id1 = countup({ to: 100, el, label: "a", ...linear });
    countupTick(0, 0);
    countupTick(500, 500); // 50
    // 不同 label 也按元素命中原任务，原地重定（不新建竞争任务）
    const id2 = countup({ to: 10, el, label: "b", ...linear });
    expect(id2).toBe(id1);
    countup.clear("b"); // b 组本就没有该任务
    countupTick(600, 100);
    expect(el.textContent).toBe("50"); // 仍从当前值续接，未被清掉、未从 0 起
  });

  it("different elements stay independent (no retarget across elements)", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const idA = countup({ to: 100, el: a, ...linear });
    const idB = countup({ to: 200, el: b, ...linear });
    expect(idB).not.toBe(idA); // 不同元素 → 各自独立任务
  });
});
