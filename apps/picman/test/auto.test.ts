// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { auto } from "../src/page/auto";
import { _setServiceWorkerContainer } from "../src/page/messages";
import { withStageParam } from "../src/shared/protocol";

function fakeSW() {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    controller: {},
    addEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.delete(cb),
    emit: (data: unknown) => listeners.forEach(cb => cb({ data } as MessageEvent)),
  };
}
const flush = () => new Promise(r => setTimeout(r, 0)); // 等 MutationObserver 微任务

const URL1 = "https://a.com/x.gif";
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); _setServiceWorkerContainer(null); document.body.innerHTML = ""; });

describe("auto", () => {
  it("已有 <img> 收到 complete 后切到全图 URL", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto();
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "1"));
  });
  it("后插入的 <img> 也被接管;first-frame 先行", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    stop = auto();
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    await flush();
    sw.emit({ picman: 1, type: "first-frame", url: URL1 });
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "ff"));
  });
  it("data-picman-bg 元素切 backgroundImage", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const div = document.createElement("div");
    div.setAttribute("data-picman-bg", URL1);
    document.body.append(div);
    stop = auto();
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await flush();
    expect(div.style.backgroundImage).toContain(withStageParam(URL1, "1"));
  });
  it("晚到元素:阶段已知立即 swap(错过通知补偿)", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    stop = auto();
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "1"));
  });
  it("stop() 后不再接管", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto();
    stop();
    stop = undefined;
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.src).toBe(URL1);
  });
});
