// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { auto } from "../src/page/auto";
import { _setServiceWorkerContainer } from "../src/page/messages";
import { PARAM_BYPASS, withStageParam } from "../src/shared/protocol";

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
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
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
    sw.emit({ imgprogress: 1, type: "first-frame", url: URL1 });
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "ff"));
  });
  it("data-imgprogress-bg 元素切 backgroundImage", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const div = document.createElement("div");
    div.setAttribute("data-imgprogress-bg", URL1);
    document.body.append(div);
    stop = auto();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(div.style.backgroundImage).toContain(withStageParam(URL1, "1"));
  });
  it("晚到元素:阶段已知立即 swap(错过通知补偿)", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    stop = auto();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "1"));
  });
  it("error 触发重试:src 保持 bypass URL,不被已知阶段覆盖回去", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto({ onError: () => {} });
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "1"));

    sw.emit({ imgprogress: 1, type: "error", url: URL1, stage: "download", message: "net" });
    await flush();
    expect(img.src).toContain(PARAM_BYPASS);
  });
  it("元素 src 从 A 换成 B 后,A 的 complete 通知不再改动该元素", async () => {
    const URL_B = "https://a.com/y.gif";
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto();
    await flush();
    img.src = URL_B;
    await flush();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.src).toBe(URL_B);
    // B 的通知仍然生效
    sw.emit({ imgprogress: 1, type: "complete", url: URL_B });
    await flush();
    expect(img.src).toBe(withStageParam(URL_B, "1"));
  });
  it('背景元素的 url() 加引号并转义:含括号与反斜杠的 URL 写入 `url("...")`', async () => {
    // happy-dom 对这类值回读为空,所以直接拦截 backgroundImage 的 setter 断言实际写入的字符串
    const setter = vi.spyOn(Object.getPrototypeOf(document.createElement("div").style), "backgroundImage", "set");
    try {
      const sw = fakeSW();
      _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
      const raw = "https://a.com/x(1).gif?q=a\\b";
      const div = document.createElement("div");
      div.setAttribute("data-imgprogress-bg", raw);
      document.body.append(div);
      stop = auto();
      const canonical = new URL(raw).href;
      sw.emit({ imgprogress: 1, type: "complete", url: canonical });
      await flush();
      const full = withStageParam(canonical, "1");
      expect(full).toContain("\\b"); // 前提:URL 解析保留了反斜杠
      expect(setter).toHaveBeenLastCalledWith(`url("${full.replaceAll("\\", "\\\\")}")`);
    } finally {
      setter.mockRestore();
    }
  });
  it("A 的 src 改成另一个已被跟踪且阶段未知的 B:A 转入 B 的跟踪,X 的通知不再改写 A", async () => {
    const URL_B = "https://a.com/y.gif";
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const a = document.createElement("img");
    a.src = URL1;
    const b = document.createElement("img");
    b.src = URL_B;
    document.body.append(a, b);
    stop = auto();
    await flush();
    a.src = URL_B;
    await flush();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(a.src).toBe(URL_B);
    sw.emit({ imgprogress: 1, type: "complete", url: URL_B });
    await flush();
    expect(a.src).toBe(withStageParam(URL_B, "1"));
    expect(b.src).toBe(withStageParam(URL_B, "1"));
  });
  it("img 的 src 被移除后,旧 URL 的 complete 通知不会把 src 写回", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto();
    await flush();
    img.removeAttribute("src");
    await flush();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.hasAttribute("src")).toBe(false);
  });
  it("背景元素的 data-imgprogress-bg 被移除后不再被改写", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const div = document.createElement("div");
    div.setAttribute("data-imgprogress-bg", URL1);
    document.body.append(div);
    stop = auto();
    await flush();
    div.removeAttribute("data-imgprogress-bg");
    await flush();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(div.style.backgroundImage).toBe("");
  });
  it("自定义 root:元素移出 root 但仍在文档中时也会被清理", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const rootEl = document.createElement("div");
    const img = document.createElement("img");
    img.src = URL1;
    rootEl.append(img);
    document.body.append(rootEl);
    stop = auto({ root: rootEl as unknown as Document });
    await flush();
    document.body.append(img); // 移出 root,但仍 isConnected
    await flush();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.src).toBe(URL1);
  });
  it("未被跟踪的 URL 的通知不写 stageOf:之后才出现的元素不会被立即切换", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    stop = auto();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    await flush();
    expect(img.src).toBe(URL1);
  });
  it("通知已排入 idle 后 stop():回调不再回写元素", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    stop();
    stop = undefined;
    await flush();
    expect(img.src).toBe(URL1);
  });
  it('src=""(属性为空)视为无 src:初始不跟踪,运行中置空则释放', async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const empty = document.createElement("img");
    empty.setAttribute("src", "");
    const live = document.createElement("img");
    live.src = URL1;
    document.body.append(empty, live);
    stop = auto();
    await flush();
    live.setAttribute("src", "");
    await flush();
    // 空 src 解析成页面 URL:若被当作有效 src 跟踪,这些通知会把 src 写进去
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    sw.emit({ imgprogress: 1, type: "complete", url: new URL("", location.href).href });
    await flush();
    expect(empty.getAttribute("src")).toBe("");
    expect(live.getAttribute("src")).toBe("");
  });
  it("A 从 X 换到 B 后,把 src 改回 X 的旧阶段 URL:应重新跟踪 X,而不是被判回声", async () => {
    const URL_B = "https://a.com/y.gif";
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto({ onError: () => {} });
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    const staleStage = withStageParam(URL1, "1");
    expect(img.src).toBe(staleStage); // 我们写入过的期望值
    img.src = URL_B;
    await flush();
    img.src = staleStage;
    await flush();
    // 重新跟踪了 X:X 的 error 会让元素走 bypass 重试
    sw.emit({ imgprogress: 1, type: "error", url: URL1, stage: "download", message: "net" });
    await flush();
    expect(img.src).toContain(PARAM_BYPASS);
  });
  it("同批先移出 root 再改属性的 transient 记录:不重新跟踪", async () => {
    const URL_B = "https://a.com/y.gif";
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const rootEl = document.createElement("div");
    const img = document.createElement("img");
    img.src = URL1;
    rootEl.append(img);
    document.body.append(rootEl);
    stop = auto({ root: rootEl as unknown as Document });
    await flush();
    document.body.append(img); // 移出 root(仍在文档中)
    img.setAttribute("src", URL_B); // 同一批里再改属性
    await flush();
    sw.emit({ imgprogress: 1, type: "complete", url: URL_B });
    await flush();
    expect(img.src).toBe(URL_B);
  });
  it("背景元素同批移出自定义 root 并删掉属性:释放跟踪,complete 不改写 backgroundImage", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const rootEl = document.createElement("div");
    const div = document.createElement("div");
    div.setAttribute("data-imgprogress-bg", URL1);
    rootEl.append(div);
    document.body.append(rootEl);
    stop = auto({ root: rootEl as unknown as Document });
    await flush();
    document.body.append(div); // 移出 root(仍在文档中)
    div.removeAttribute("data-imgprogress-bg"); // 同一同步块里删属性
    await flush();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(div.style.backgroundImage).toBe("");
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
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.src).toBe(URL1);
  });
  it("元素移出 DOM 后被清理,不再接收后续阶段", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto();
    await flush();
    // 移出 DOM → MutationObserver removedNodes → untrackSubtree 主动清理
    img.remove();
    await flush();
    sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
    await flush();
    // 测试仍持有 img 引用(WeakRef 可 deref),若未清理则会被 swap 到全图;
    // src 保持原值,证明它已从 tracked 移除。
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

        sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
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

        sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
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

        sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
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

        sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
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

        sw.emit({ imgprogress: 1, type: "complete", url: URL1 });
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
