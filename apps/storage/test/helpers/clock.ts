import { vi } from "vitest";

/**
 * 仅替换 Date，保留 IDB、计时器及微任务的真实调度。
 * @param start 初始毫秒时间戳，默认固定在 2026-01-01
 * @returns 设置时间、推进时间和还原真实时钟的工具；用例 finally 中必须 restore。
 */
export function clock(start = Date.UTC(2026, 0, 1)) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  return {
    /** 设置绝对时间，不执行或推进任何定时器。 */
    set(time: number | Date) {
      vi.setSystemTime(time);
    },
    /** 推进 Date，不触碰真实异步调度。 */
    advance(milliseconds: number) {
      vi.setSystemTime(Date.now() + milliseconds);
    },
    /** 恢复真实 Date；可在 afterEach/finally 中调用。 */
    restore() {
      vi.useRealTimers();
    },
  };
}
