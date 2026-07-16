// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { definePicMan } from "../src/element/index";
import { _setServiceWorkerContainer } from "../src/page/messages";
import { withStageParam } from "../src/shared/protocol";

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
afterEach(() => {
  _setServiceWorkerContainer(null);
  document.body.innerHTML = "";
});

// scheduleIdle 优先用 requestIdleCallback;测试环境下替换成立即(0ms)触发的
// setTimeout 版本,一轮宏任务即可等到"LCP 之后才应用真实阶段"的回调跑完。
const originalRIC = (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
beforeAll(() => {
  (globalThis as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback = (cb) => setTimeout(cb, 0);
});
afterAll(() => {
  (globalThis as unknown as { requestIdleCallback: unknown }).requestIdleCallback = originalRIC;
});

describe("<pic-man>", () => {
  it("SW 缺失:直接渲染原 URL", async () => {
    definePicMan();
    const el = document.createElement("pic-man");
    el.setAttribute("src", URL1);
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 0));
    const img = el.shadowRoot!.querySelector("img")!;
    expect(img.src).toBe(URL1);
  });
  it("阶段推进更新内部 img", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    definePicMan();
    const el = document.createElement("pic-man");
    el.setAttribute("src", URL1);
    el.setAttribute("alt", "demo");
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 0));
    const img = el.shadowRoot!.querySelector("img")!;
    expect(img.src).toBe(URL1); // placeholder 阶段 = 原 URL(SW 回占位)
    expect(img.alt).toBe("demo");
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(img.src).toBe(withStageParam(URL1, "1"));
  });
  it("重复 definePicMan 幂等", () => {
    definePicMan();
    expect(() => definePicMan()).not.toThrow();
  });
});
