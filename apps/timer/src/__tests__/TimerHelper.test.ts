import { describe, it, expect } from "vitest";
import { ease, easeAsymmetricS } from "../TimerHelper";

describe("ease — 内置缓动函数", () => {
  it("linear: 恒等", () => {
    expect(ease.linear(0)).toBe(0);
    expect(ease.linear(0.5)).toBe(0.5);
    expect(ease.linear(1)).toBe(1);
  });

  it("easeInQuad: t^2", () => {
    expect(ease.easeInQuad(0)).toBe(0);
    expect(ease.easeInQuad(0.5)).toBe(0.25);
    expect(ease.easeInQuad(1)).toBe(1);
  });

  it("easeOutQuad: t*(2-t)", () => {
    expect(ease.easeOutQuad(0)).toBe(0);
    expect(ease.easeOutQuad(1)).toBe(1);
    expect(ease.easeOutQuad(0.5)).toBe(0.75);
  });

  it("其他缓动端点恒为 0/1", () => {
    for (const fn of [ease.easeInOutQuad, ease.easeOutCubic, ease.easeInOutCubic, ease.easeCountUp]) {
      expect(fn(0)).toBeCloseTo(0, 5);
      expect(fn(1)).toBeCloseTo(1, 5);
    }
  });
});

describe("easeAsymmetricS(skew)", () => {
  it("端点恒为 0/1", () => {
    const fn = easeAsymmetricS(0.3);
    expect(fn(0)).toBeCloseTo(0, 5);
    expect(fn(1)).toBeCloseTo(1, 5);
  });

  it("skew=0.5 等同对称 smoothstep", () => {
    const fn = easeAsymmetricS(0.5);
    expect(fn(0.5)).toBeCloseTo(0.5, 5);
  });
});
