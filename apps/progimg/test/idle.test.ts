import { afterEach, describe, expect, it, vi } from "vitest";
import { _setLcpSeen, DEFAULT_IDLE_TIMEOUT, scheduleIdle } from "../src/page/idle";

describe("scheduleIdle", () => {
  const originalRIC = (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  afterEach(() => {
    (globalThis as unknown as { requestIdleCallback: unknown }).requestIdleCallback = originalRIC;
    _setLcpSeen(true); // 测试环境默认 LCP 已见(supportedEntryTypes 检测的兜底) — restore the test-env default
  });

  it("存在 requestIdleCallback 时优先使用它,并透传 timeout", () => {
    const ric = vi.fn();
    (globalThis as unknown as { requestIdleCallback: typeof ric }).requestIdleCallback = ric;
    scheduleIdle(() => {}, 5000);
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });
  });

  it("不指定 timeout 时使用 DEFAULT_IDLE_TIMEOUT", () => {
    const ric = vi.fn();
    (globalThis as unknown as { requestIdleCallback: typeof ric }).requestIdleCallback = ric;
    scheduleIdle(() => {});
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: DEFAULT_IDLE_TIMEOUT });
  });

  it("LCP 已见:idle 到来即执行工作", () => {
    _setLcpSeen(true);
    const ric = vi.fn((cb: () => void) => cb()); // idle 立即触发
    (globalThis as unknown as { requestIdleCallback: typeof ric }).requestIdleCallback = ric;
    const work = vi.fn();
    scheduleIdle(work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("LCP 未见:idle 后不立即执行,等到 LCP 条目出现才执行", async () => {
    _setLcpSeen(false);
    const ric = vi.fn((cb: () => void) => cb()); // idle 立即触发
    (globalThis as unknown as { requestIdleCallback: typeof ric }).requestIdleCallback = ric;
    const work = vi.fn();
    scheduleIdle(work);
    expect(work).not.toHaveBeenCalled(); // idle 到了但 LCP 还没来

    _setLcpSeen(true);
    await new Promise((r) => setTimeout(r, 150)); // 轮询间隔 100ms
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("LCP 一直不出现:超时兜底后仍会执行,不会卡死", async () => {
    _setLcpSeen(false);
    const ric = vi.fn((cb: () => void) => cb());
    (globalThis as unknown as { requestIdleCallback: typeof ric }).requestIdleCallback = ric;
    const work = vi.fn();
    scheduleIdle(work);
    await new Promise((r) => setTimeout(r, 1200)); // LCP_EXTRA_WAIT(1000ms) 兜底
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("无 requestIdleCallback 时退回 setTimeout", async () => {
    (globalThis as unknown as { requestIdleCallback: unknown }).requestIdleCallback = undefined;
    let called = false;
    scheduleIdle(() => {
      called = true;
    }, 0);
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(true);
  });
});
