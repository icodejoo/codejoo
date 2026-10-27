// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { _setServiceWorkerContainer, subscribe } from "../src/page/messages";

/** 假 ServiceWorkerContainer:可手动派发 message */
function fakeSW() {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    controller: {},
    addEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.delete(cb),
    emit: (data: unknown) => listeners.forEach((cb) => cb({ data } as MessageEvent)),
  };
}

const URL1 = "https://a.com/x.gif";
afterEach(() => _setServiceWorkerContainer(null));

describe("messages.subscribe", () => {
  it("退订幂等:A 退订后 B 订阅,A 再次退订不影响 B", () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribe(URL1, a);
    unsubA();
    subscribe(URL1, b);
    unsubA();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
  });
  it("退订后收不到该 URL 的消息", () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const cb = vi.fn();
    subscribe(URL1, cb)();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    expect(cb).not.toHaveBeenCalled();
  });
});
