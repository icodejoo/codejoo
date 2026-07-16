import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_IDLE_TIMEOUT, scheduleIdle } from "../src/page/idle";

describe("scheduleIdle", () => {
  const originalRIC = (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  afterEach(() => {
    (globalThis as unknown as { requestIdleCallback: unknown }).requestIdleCallback = originalRIC;
  });

  it("存在 requestIdleCallback 时优先使用它,并透传 timeout", () => {
    const ric = vi.fn();
    (globalThis as unknown as { requestIdleCallback: typeof ric }).requestIdleCallback = ric;
    const cb = () => {};
    scheduleIdle(cb, 5000);
    expect(ric).toHaveBeenCalledWith(cb, { timeout: 5000 });
  });

  it("不指定 timeout 时使用 DEFAULT_IDLE_TIMEOUT", () => {
    const ric = vi.fn();
    (globalThis as unknown as { requestIdleCallback: typeof ric }).requestIdleCallback = ric;
    const cb = () => {};
    scheduleIdle(cb);
    expect(ric).toHaveBeenCalledWith(cb, { timeout: DEFAULT_IDLE_TIMEOUT });
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
