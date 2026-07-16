// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { auto } from "../src/page/auto";
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
const flush = () => new Promise((r) => setTimeout(r, 0)); // 等一轮宏任务(MutationObserver 微任务 + scheduleIdle 回调)

// scheduleIdle 优先用 requestIdleCallback;测试环境下替换成立即(0ms)触发的
// setTimeout 版本,flush() 一轮宏任务即可等到"LCP 之后才应用真实阶段"的回调跑完。
const originalRIC = (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
beforeAll(() => {
  (globalThis as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback = (cb) => setTimeout(cb, 0);
});
afterAll(() => {
  (globalThis as unknown as { requestIdleCallback: unknown }).requestIdleCallback = originalRIC;
});

const URL1 = "https://a.com/x.gif";
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  _setServiceWorkerContainer(null);
  document.body.innerHTML = "";
});

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

  describe("缓存对账(reconciliation)——补偿错过的 SW 通知", () => {
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

    it("SW 通知从未到达,但 ff/1 均已缓存:track() 主动补上(先首帧后完整的顺序由实现保证)", async () => {
      const sw = fakeSW();
      _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
      fakeCaches(new Set([withStageParam(URL1, "ff"), withStageParam(URL1, "1")]));

      const img = document.createElement("img");
      img.src = URL1;
      document.body.append(img);
      stop = auto();

      await flush();
      await flush();
      await flush();
      expect(img.src).toBe(withStageParam(URL1, "1"));
    });

    it("只有 1 已缓存(无 ff):直接补上完整版本", async () => {
      const sw = fakeSW();
      _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
      fakeCaches(new Set([withStageParam(URL1, "1")]));

      const img = document.createElement("img");
      img.src = URL1;
      document.body.append(img);
      stop = auto();

      await flush();
      await flush();
      expect(img.src).toBe(withStageParam(URL1, "1"));
    });

    it("缓存未命中时不误触发 swap", async () => {
      const sw = fakeSW();
      _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
      fakeCaches(new Set());

      const img = document.createElement("img");
      img.src = URL1;
      document.body.append(img);
      stop = auto();

      await flush();
      await flush();
      expect(img.src).toBe(URL1);
    });
  });

  describe("完整阶段的视口门控", () => {
    /** 假 IntersectionObserver:记录 observe 的元素,可手动触发进入视口 — fake IO: records observed elements, fires entry manually */
    function fakeIO() {
      const observed = new Set<Element>();
      let cb: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | null = null;
      class FakeIO {
        constructor(callback: typeof cb) {
          cb = callback;
        }
        observe(el: Element) {
          observed.add(el);
        }
        unobserve(el: Element) {
          observed.delete(el);
        }
        disconnect() {
          observed.clear();
        }
      }
      const orig = (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
      (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
      return {
        observed,
        enter: (el: Element) => cb?.([{ target: el, isIntersecting: true }]),
        leave: (el: Element) => cb?.([{ target: el, isIntersecting: false }]),
        restore: () => {
          (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = orig;
        },
      };
    }

    it("视口外元素:complete 不立即切换,进入视口才换高清", async () => {
      const io = fakeIO();
      try {
        const sw = fakeSW();
        _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);

        const img = document.createElement("img");
        img.src = URL1;
        // happy-dom 布局为零尺寸会被 inViewport 视为可见——mock 出一个视口外的矩形
        img.getBoundingClientRect = () => ({ top: 5000, bottom: 5100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 5000, toJSON: () => ({}) }) as DOMRect;
        (globalThis as unknown as { innerHeight: number }).innerHeight = 800;
        document.body.append(img);
        stop = auto();

        sw.emit({ picman: 1, type: "complete", url: URL1 });
        await flush();
        expect(img.src).toBe(URL1); // 未进入视口:保持原样,不切高清

        io.enter(img);
        expect(img.src).toBe(withStageParam(URL1, "1")); // 进入视口:立即换高清
      } finally {
        io.restore();
      }
    });

    it("视口内元素:complete 照常在 idle 后切换,不被门控挡住", async () => {
      const io = fakeIO();
      try {
        const sw = fakeSW();
        _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);

        const img = document.createElement("img");
        img.src = URL1;
        img.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
        (globalThis as unknown as { innerHeight: number }).innerHeight = 800;
        document.body.append(img);
        stop = auto();

        sw.emit({ picman: 1, type: "complete", url: URL1 });
        await flush();
        expect(img.src).toBe(withStageParam(URL1, "1"));
      } finally {
        io.restore();
      }
    });

    it("offViewport:'thumbnail' —— 离开视口回退到 ff,再进入恢复高清,不触发反馈回路", async () => {
      const io = fakeIO();
      try {
        const sw = fakeSW();
        _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);

        const img = document.createElement("img");
        img.src = URL1;
        img.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
        (globalThis as unknown as { innerHeight: number }).innerHeight = 800;
        document.body.append(img);
        stop = auto({ offViewport: "thumbnail" });

        sw.emit({ picman: 1, type: "complete", url: URL1 });
        await flush();
        expect(img.src).toBe(withStageParam(URL1, "1")); // 视口内:高清

        io.leave(img);
        await flush();
        expect(img.src).toBe(withStageParam(URL1, "ff")); // 离开视口:回退缩略图

        io.enter(img);
        await flush();
        expect(img.src).toBe(withStageParam(URL1, "1")); // 再进入:恢复高清
      } finally {
        io.restore();
      }
    });

    it("offViewport:'placeholder' —— 离开视口回退到页面端色块 data URI", async () => {
      const io = fakeIO();
      try {
        const sw = fakeSW();
        _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);

        const img = document.createElement("img");
        img.src = URL1;
        img.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
        (globalThis as unknown as { innerHeight: number }).innerHeight = 800;
        document.body.append(img);
        stop = auto({ offViewport: "placeholder" });

        sw.emit({ picman: 1, type: "complete", url: URL1 });
        await flush();
        expect(img.src).toBe(withStageParam(URL1, "1"));

        io.leave(img);
        await flush();
        expect(img.src).toContain("data:image/svg+xml"); // 回退到色块
      } finally {
        io.restore();
      }
    });

    it("offViewport 默认 'keep':离开视口不回退", async () => {
      const io = fakeIO();
      try {
        const sw = fakeSW();
        _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);

        const img = document.createElement("img");
        img.src = URL1;
        img.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
        (globalThis as unknown as { innerHeight: number }).innerHeight = 800;
        document.body.append(img);
        stop = auto();

        sw.emit({ picman: 1, type: "complete", url: URL1 });
        await flush();
        io.leave(img);
        await flush();
        expect(img.src).toBe(withStageParam(URL1, "1")); // 保持高清
      } finally {
        io.restore();
      }
    });
  });
});
