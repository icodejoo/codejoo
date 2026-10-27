// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { defineProgimg } from "../src/element/index";
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

describe("<prog-img>", () => {
  it("SW 缺失:直接渲染原 URL", async () => {
    defineProgimg();
    const el = document.createElement("prog-img");
    el.setAttribute("src", URL1);
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 0));
    const img = el.shadowRoot!.querySelector("img")!;
    expect(img.src).toBe(URL1);
  });
  it("阶段推进更新内部 img", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    defineProgimg();
    const el = document.createElement("prog-img");
    el.setAttribute("src", URL1);
    el.setAttribute("alt", "demo");
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 0));
    const img = el.shadowRoot!.querySelector("img")!;
    expect(img.src).toBe(URL1); // placeholder 阶段 = 原 URL(SW 回占位)
    expect(img.alt).toBe("demo");
    sw.emit({ progimg: 1, type: "complete", url: URL1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(img.src).toBe(withStageParam(URL1, "1"));
  });
  it("src 被移除:旧加载回调失效且内部 img 清空 src", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    defineProgimg();
    const el = document.createElement("prog-img");
    el.setAttribute("src", URL1);
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 0));
    const img = el.shadowRoot!.querySelector("img")!;
    el.removeAttribute("src");
    expect(img.hasAttribute("src")).toBe(false);
    sw.emit({ progimg: 1, type: "complete", url: URL1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(img.hasAttribute("src")).toBe(false);
  });
  it("默认标签注册后可再注册另一个标签名而不抛错", () => {
    defineProgimg();
    expect(() => defineProgimg("prog-img-alt")).not.toThrow();
    expect(customElements.get("prog-img-alt")).toBeDefined();
  });
  it("重复 defineProgimg 幂等", () => {
    defineProgimg();
    expect(() => defineProgimg()).not.toThrow();
  });
});
