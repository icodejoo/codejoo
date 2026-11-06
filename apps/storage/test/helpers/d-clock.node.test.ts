import { describe, expect, it } from "vitest";
import { clock } from "./clock";

describe("D node clock", () => {
  it("set/advance 保留真实 timeout，restore 恢复真实 Date", async () => {
    const NativeDate = Date;
    const time = clock(100);
    try {
      expect(Date.now()).toBe(100);
      time.set(new Date(200));
      time.advance(50);
      expect(Date.now()).toBe(250);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    } finally {
      time.restore();
    }
    expect(Date).toBe(NativeDate);
  });
  it("默认起点固定且允许数字绝对时间", () => {
    const time = clock();
    try {
      expect(Date.now()).toBe(Date.UTC(2026, 0, 1));
      time.set(500);
      expect(Date.now()).toBe(500);
    } finally {
      time.restore();
    }
  });
});
