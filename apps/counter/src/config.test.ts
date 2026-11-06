import { afterEach, describe, expect, it } from "vitest";
import { configure, resetAllDefaults } from "./config";
import { defaults as downDefaults } from "./count-down/count-down";
import { defaults as upDefaults } from "./count-up/count-up";
import { fpsToInterval, throttle, untilNext, type IThrottled } from "./core/throttle";

describe("configure / reset", () => {
  afterEach(() => resetAllDefaults());

  it("configure 一次设置，两边默认值同时生效", () => {
    configure({ fps: 30, muteHidden: false });
    expect(upDefaults.fps).toBe(30);
    expect(downDefaults.fps).toBe(30);
    expect(upDefaults.muteHidden).toBe(false);
    expect(downDefaults.muteHidden).toBe(false);
  });

  it("resetAllDefaults 还原出厂值，并保持 defaults 对象引用", () => {
    const ref = upDefaults;
    configure({ fps: 24 });
    (downDefaults as Record<string, unknown>).extra = 1;
    resetAllDefaults();
    expect(upDefaults).toBe(ref);
    expect(upDefaults.fps).toBe(0);
    expect(downDefaults.fps).toBe(0);
    expect("extra" in downDefaults).toBe(false);
  });
});

describe("throttle 网格节流", () => {
  const mk = (fps: number): IThrottled => ({ interval: fpsToInterval(fps), nextAt: 0 });

  it("fps<=0 不限帧", () => {
    expect(fpsToInterval(0)).toBe(0);
    expect(throttle(mk(0), 123)).toBe(0);
  });

  it("首次到点并起网格；未到点返回等待时长；容差内视为到点", () => {
    const t = mk(50); // 20ms
    expect(throttle(t, 100)).toBe(0);
    expect(t.nextAt).toBe(120);
    expect(throttle(t, 105)).toBe(7); // 120-8-105
    expect(throttle(t, 113)).toBe(0); // 容差内
    expect(t.nextAt).toBe(140);
  });

  it("错过多个时隙时跳过、不补发", () => {
    const t = mk(50);
    throttle(t, 100); // nextAt=120
    expect(throttle(t, 300)).toBe(0);
    expect(t.nextAt).toBe(320);
  });

  it("untilNext 给出距下个网格点（含容差）的距离", () => {
    const t = mk(50);
    throttle(t, 100);
    expect(untilNext(t, 100)).toBe(12);
  });
});
