// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "../src/page/load";
import { _setServiceWorkerContainer } from "../src/page/messages";
import { withStageParam } from "../src/shared/protocol";

/** 假 ServiceWorkerContainer:可手动派发 message */
function fakeSW() {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    controller: {},
    addEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.delete(cb),
    emit: (data: unknown) => listeners.forEach(cb => cb({ data } as MessageEvent)),
  };
}
afterEach(() => _setServiceWorkerContainer(null));

const URL1 = "https://a.com/x.gif";

describe("load", () => {
  it("SW 缺失:立即 complete + 原 URL", async () => {
    _setServiceWorkerContainer(null);
    const stages: string[] = [];
    const task = load(URL1).onStage(s => stages.push(s));
    await expect(task.done).resolves.toBe(URL1);
    expect(stages).toContain("complete");
  });
  it("三段事件顺序 + displayUrl 带阶段参数", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const seen: [string, string][] = [];
    const task = load(URL1).onStage((s, u) => seen.push([s, u]));
    await Promise.resolve(); // placeholder 微任务
    sw.emit({ picman: 1, type: "first-frame", url: URL1 });
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await expect(task.done).resolves.toBe(withStageParam(URL1, "1"));
    expect(seen).toEqual([
      ["placeholder", URL1],
      ["first-frame", withStageParam(URL1, "ff")],
      ["complete", withStageParam(URL1, "1")],
    ]);
  });
  it("其他 URL 的消息不串扰", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const cb = vi.fn();
    load(URL1).onStage(cb);
    sw.emit({ picman: 1, type: "complete", url: "https://a.com/other.gif" });
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalledWith("complete", expect.anything());
  });
  it("download error → done reject", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const task = load(URL1);
    task.done.catch(() => {}); // 防未处理
    sw.emit({ picman: 1, type: "error", url: URL1, stage: "download", message: "net" });
    await expect(task.done).rejects.toBeTruthy();
  });
});
