// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { _setServiceWorkerContainer } from "../src/page/messages";
import { registerImgprogressSW } from "../src/page/register";

/** 临时替换 navigator.serviceWorker */
function installSW(sw: unknown): void {
  Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
}

afterEach(() => {
  vi.useRealTimers();
  installSW(undefined);
  _setServiceWorkerContainer(null);
});

describe("registerImgprogressSW", () => {
  it("注册成功但 ready 永不 resolve:超时后降级为未控制,仍返回 stop", async () => {
    vi.useFakeTimers();
    const sw = {
      controller: null,
      register: vi.fn().mockResolvedValue({}),
      ready: new Promise(() => {}),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    installSW(sw);
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);

    const p = registerImgprogressSW("/imgprogress-sw.js");
    await vi.advanceTimersByTimeAsync(10000);
    const r = await p;
    expect(r.controlled).toBe(false);
    expect(typeof r.stop).toBe("function");
    r.stop();
  });
  it("ready 正常 resolve:按 controller 判定 controlled", async () => {
    const sw = {
      controller: {},
      register: vi.fn().mockResolvedValue({}),
      ready: Promise.resolve({}),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    installSW(sw);
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);

    const r = await registerImgprogressSW("/imgprogress-sw.js");
    expect(r.controlled).toBe(true);
    r.stop();
  });
});
