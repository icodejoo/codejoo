// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
    emit: (data: unknown) => listeners.forEach((cb) => cb({ data } as MessageEvent)),
  };
}
/** 等一轮宏任务,足够让 scheduleIdle(基于 requestIdleCallback/setTimeout)的回调跑完 — flush one macrotask, enough for scheduleIdle's callback to run */
const flush = () => new Promise((r) => setTimeout(r, 0));

// scheduleIdle 优先用 requestIdleCallback;测试环境下把它替换成立即(0ms)触发的
// setTimeout 版本,这样 flush() 一轮宏任务就能等到"LCP 之后才应用真实阶段"的回调跑完,
// 不需要真的等待其 2000ms 默认超时。
// scheduleIdle prefers requestIdleCallback; in tests, replace it with an
// immediate (0ms) setTimeout version so a single flush() macrotask is enough
// to wait out the "apply the real stage only past the LCP" callback, instead
// of actually waiting its 2000ms default timeout.
const originalRIC = (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
beforeAll(() => {
  (globalThis as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback = (cb) => setTimeout(cb, 0);
});
afterAll(() => {
  (globalThis as unknown as { requestIdleCallback: unknown }).requestIdleCallback = originalRIC;
});

const URL1 = "https://a.com/x.gif";
afterEach(() => _setServiceWorkerContainer(null));

describe("load", () => {
  it("SW 缺失:立即 complete + 原 URL", async () => {
    _setServiceWorkerContainer(null);
    const stages: string[] = [];
    const task = load(URL1).onStage((s) => stages.push(s));
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
    await flush();
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
    await flush();
    expect(cb).not.toHaveBeenCalledWith("complete", expect.anything());
  });
  it("download error → done reject(错误不受 idle 调度影响,立即 reject)", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const task = load(URL1);
    task.done.catch(() => {}); // 防未处理
    sw.emit({ picman: 1, type: "error", url: URL1, stage: "download", message: "net" });
    await expect(task.done).rejects.toBeTruthy();
  });

  describe("缓存对账(reconciliation)", () => {
    const originalCaches = globalThis.caches;
    afterEach(() => {
      globalThis.caches = originalCaches;
    });

    /** 装一个只认识指定 stage URL 的假 CacheStorage — install a fake CacheStorage recognizing only the given stage URLs */
    function fakeCaches(hitUrls: Set<string>): void {
      const reqUrl = (req: RequestInfo | URL): string => (typeof req === "string" ? req : req instanceof URL ? req.href : req.url);
      globalThis.caches = {
        match: (req: RequestInfo | URL) => Promise.resolve(hitUrls.has(reqUrl(req)) ? new Response("cached") : undefined),
      } as unknown as CacheStorage;
    }

    it("ff 与 1 均已缓存:先 first-frame 后 complete,顺序不倒(仍在 LCP 之后才应用)", async () => {
      const sw = fakeSW();
      _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
      fakeCaches(new Set([withStageParam(URL1, "ff"), withStageParam(URL1, "1")]));

      const seen: string[] = [];
      const task = load(URL1).onStage((s) => seen.push(s));
      await flush();
      await flush();
      await task.done;

      expect(seen.indexOf("first-frame")).toBeGreaterThanOrEqual(0);
      expect(seen.indexOf("first-frame")).toBeLessThan(seen.indexOf("complete"));
    });

    it("只有 1 缓存(无 ff):直接 complete,不会因缺 ff 而卡住", async () => {
      const sw = fakeSW();
      _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
      fakeCaches(new Set([withStageParam(URL1, "1")]));

      const seen: string[] = [];
      const task = load(URL1).onStage((s) => seen.push(s));
      await flush();
      await flush();
      await expect(task.done).resolves.toBe(withStageParam(URL1, "1"));
      expect(seen).not.toContain("first-frame");
      expect(seen).toContain("complete");
    });

    it("SW 实时通知与缓存对账都命中 first-frame 时只 emit 一次", async () => {
      const sw = fakeSW();
      _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
      fakeCaches(new Set([withStageParam(URL1, "ff")]));

      const cb = vi.fn();
      load(URL1).onStage(cb);
      await Promise.resolve();
      sw.emit({ picman: 1, type: "first-frame", url: URL1 });
      await flush();
      await flush();

      const firstFrameCalls = cb.mock.calls.filter((c) => c[0] === "first-frame");
      expect(firstFrameCalls.length).toBe(1);
    });
  });
});
