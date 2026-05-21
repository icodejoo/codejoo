import { describe, it, expect, vi, afterEach } from "vitest";
import { Timer } from "../Timer";
import { createTestTimer } from "./helpers";

describe("Timer — 核心 API", () => {
  afterEach(() => vi.useRealTimers());

  it("setTimeout: 到期执行一次，返回任务 ID", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    const id = timer.setTimeout(cb, 1000);
    expect(typeof id).toBe("number");
    advance(500);
    expect(cb).not.toHaveBeenCalled();
    advance(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    advance(2000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setTimeout: 默认 1000ms", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    timer.setTimeout(cb);
    advance(999);
    expect(cb).not.toHaveBeenCalled();
    advance(1000);
    expect(cb).toHaveBeenCalled();
  });

  it("setInterval: 周期触发", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    timer.setInterval(cb, 1000);
    advance(1000);
    advance(2000);
    advance(3000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("setInterval(boolean): immediate 语义占位（接口不抛错）", () => {
    const { timer } = createTestTimer();
    expect(() => timer.setInterval(() => {}, true)).not.toThrow();
  });

  it("setInterval({ interval, immediate })", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    timer.setInterval(cb, { interval: 500, immediate: false });
    advance(500);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setImmediate: 下一次 tick 立即执行", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    timer.setImmediate(cb);
    advance(0);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("remove: 取消已注册任务", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    const id = timer.setInterval(cb, 500);
    timer.remove(id);
    advance(500);
    advance(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("size getter: 反映 manager.size", () => {
    const { timer } = createTestTimer();
    expect(timer.size).toBe(0);
    timer.setInterval(() => {}, 100);
    expect(timer.size).toBe(1);
    timer.setInterval(() => {}, 200);
    expect(timer.size).toBe(2);
  });

  it("paused / pause / resume 状态切换", () => {
    const { timer } = createTestTimer();
    expect(timer.paused).toBe(false);
    timer.pause();
    expect(timer.paused).toBe(true);
    timer.resume();
    expect(timer.paused).toBe(false);
  });

  it("pause/resume 重复调用无副作用", () => {
    const { timer } = createTestTimer();
    timer.pause();
    timer.pause();
    expect(timer.paused).toBe(true);
    timer.resume();
    timer.resume();
    expect(timer.paused).toBe(false);
  });

  it("多个回调可挂同一 interval", () => {
    const { timer, advance } = createTestTimer();
    const a = vi.fn(),
      b = vi.fn();
    timer.setInterval(a, 100);
    timer.setInterval(b, 100);
    advance(100);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("Timer.defaults: 全局默认 interval", () => {
    const original = Timer.defaults.interval;
    Timer.defaults.interval = 33;
    const t = new Timer();
    t.stop();
    expect(t.frameInterval).toBe(33);
    Timer.defaults.interval = original;
  });

  it("start: 重置时间基准", () => {
    const { timer } = createTestTimer();
    const before = timer.beginAt;
    timer.start();
    timer.stop();
    expect(timer.beginAt).toBeGreaterThanOrEqual(before);
  });
});
