// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVideoFacade, resolveVideoOptions, type VideoFrameDeps } from "../src/page/video";
import { PARAM_PLAY } from "../src/shared/protocol";

const VIDEO_URL = "https://a.com/hero.mp4";
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** 一个不触发真实抓帧的最小依赖(用于纯 facade 行为测试) */
function inertDeps(): VideoFrameDeps {
  return {
    fetchImpl: vi.fn().mockRejectedValue(new Error("no fetch in this test")) as unknown as typeof fetch,
    createVideo: () => document.createElement("video"),
    createCanvas: () => ({ getContext: () => null, toDataURL: () => "data:image/jpeg;base64,AAAA" }),
  };
}

/** 一个可控的离屏 <video> 桩,src 一被赋值即在微任务里派发 loadeddata */
function stubVideo(width = 160, height = 90, autoLoad = true): HTMLVideoElement & { listenerCount: () => number } {
  const listeners: Record<string, (() => void)[]> = {};
  let src = "";
  return {
    muted: false,
    preload: "",
    videoWidth: width,
    videoHeight: height,
    get src() {
      return src;
    },
    set src(v: string) {
      src = v;
      if (autoLoad) queueMicrotask(() => (listeners.loadeddata ?? []).forEach((f) => f()));
    },
    addEventListener(type: string, cb: () => void) {
      (listeners[type] ??= []).push(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb);
    },
    /** 当前仍挂着的监听器总数 */
    listenerCount: () => Object.values(listeners).reduce((n, l) => n + l.length, 0),
    removeAttribute() {},
  } as unknown as HTMLVideoElement & { listenerCount: () => number };
}

/** 全局改写前的 URL.createObjectURL/revokeObjectURL 原值,afterEach 恢复 */
const originalURLDescs = {
  create: Object.getOwnPropertyDescriptor(globalThis.URL, "createObjectURL"),
  revoke: Object.getOwnPropertyDescriptor(globalThis.URL, "revokeObjectURL"),
};

/** 按保存的属性描述符恢复(原先没有则删除) */
function restoreURLProp(name: "createObjectURL" | "revokeObjectURL", desc: PropertyDescriptor | undefined): void {
  if (desc) Object.defineProperty(globalThis.URL, name, desc);
  else delete (globalThis.URL as unknown as Record<string, unknown>)[name];
}

beforeEach(() => {
  // 稳定 idle 调度与 objectURL(happy-dom 未必实现);afterEach 里统一恢复
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => setTimeout(cb, 0));
  globalThis.URL.createObjectURL = () => "blob:stub";
  globalThis.URL.revokeObjectURL = () => {};
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreURLProp("createObjectURL", originalURLDescs.create);
  restoreURLProp("revokeObjectURL", originalURLDescs.revoke);
});

describe("video facade", () => {
  it("中和贪婪加载:摘 src/preload/autoplay,无 poster 时上色块封面", () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    v.setAttribute("preload", "auto");
    v.setAttribute("autoplay", "");
    document.body.append(v);

    const facade = createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps());
    facade.track(v);

    expect(v.getAttribute("src")).toBe(null);
    expect(v.getAttribute("preload")).toBe("none");
    expect(v.hasAttribute("autoplay")).toBe(false);
    expect(v.poster).toContain("data:image/svg+xml");
  });

  it("已有 poster:保留,不额外生成封面", () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    v.setAttribute("poster", "https://a.com/p.jpg");
    document.body.append(v);

    createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps()).track(v);
    expect(v.getAttribute("poster")).toBe("https://a.com/p.jpg");
  });

  it(".play() 先还原真实源(带播放标记)再播放", async () => {
    const nativePlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    document.body.append(v);

    createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps()).track(v);
    expect(v.getAttribute("src")).toBe(null);

    const p = v.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    expect(v.getAttribute("src")).toContain(PARAM_PLAY);
    expect(v.getAttribute("src")).toContain("hero.mp4");
    expect(nativePlay).toHaveBeenCalledTimes(1);
  });

  it("pointerenter 手势还原真实源", () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    document.body.append(v);

    createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps()).track(v);
    v.dispatchEvent(new Event("pointerenter"));
    expect(v.getAttribute("src")).toContain(PARAM_PLAY);
  });

  it("无 poster + 抓帧成功:封面升级为首帧 data URI", async () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    document.body.append(v);

    const deps: VideoFrameDeps = {
      fetchImpl: vi.fn().mockResolvedValue(new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 206 })) as unknown as typeof fetch,
      createVideo: () => stubVideo(),
      createCanvas: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,ZZZZ" }),
    };
    createVideoFacade(resolveVideoOptions({ videoFrame: true, videoAutoplay: false }), deps).track(v);

    await flush();
    expect(v.poster).toBe("data:image/jpeg;base64,ZZZZ");
  });

  it("服务器忽略 Range 回 200:取消 body,不抓帧,停留色块封面", async () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    document.body.append(v);

    const resp = new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 });
    const cancel = vi.spyOn(resp.body!, "cancel");
    const deps: VideoFrameDeps = {
      fetchImpl: vi.fn().mockResolvedValue(resp) as unknown as typeof fetch,
      createVideo: () => stubVideo(),
      createCanvas: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,ZZZZ" }),
    };
    createVideoFacade(resolveVideoOptions({ videoFrame: true, videoAutoplay: false }), deps).track(v);

    await flush();
    expect(cancel).toHaveBeenCalled();
    expect(v.poster).toContain("data:image/svg+xml");
  });

  it("等待首帧超时:停留色块封面,且监听器已摘除", async () => {
    vi.useFakeTimers();
    try {
      const v = document.createElement("video");
      v.setAttribute("src", VIDEO_URL);
      document.body.append(v);

      const offscreen = stubVideo(160, 90, false);
      const deps: VideoFrameDeps = {
        fetchImpl: vi.fn().mockResolvedValue(new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 206 })) as unknown as typeof fetch,
        createVideo: () => offscreen,
        createCanvas: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,ZZZZ" }),
      };
      createVideoFacade(resolveVideoOptions({ videoFrame: true, videoAutoplay: false }), deps).track(v);

      await vi.advanceTimersByTimeAsync(20000);
      expect(v.poster).toContain("data:image/svg+xml");
      expect(offscreen.listenerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("抓帧失败(toDataURL 抛 SecurityError):停留色块封面", async () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    document.body.append(v);

    const deps: VideoFrameDeps = {
      fetchImpl: vi.fn().mockResolvedValue(new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 206 })) as unknown as typeof fetch,
      createVideo: () => stubVideo(),
      createCanvas: () => ({
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => {
          throw new DOMException("tainted", "SecurityError");
        },
      }),
    };
    createVideoFacade(resolveVideoOptions({ videoFrame: true, videoAutoplay: false }), deps).track(v);

    await flush();
    expect(v.poster).toContain("data:image/svg+xml");
  });

  it("autoplay after-lcp:idle 后还原并播放(视口内)", async () => {
    const nativePlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    v.setAttribute("autoplay", "");
    document.body.append(v);

    createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: "after-lcp", videoAutoplayDelay: 5 }), inertDeps()).track(v);
    expect(v.getAttribute("src")).toBe(null); // 尚未放行

    await flush(20);
    expect(v.getAttribute("src")).toContain(PARAM_PLAY);
    expect(nativePlay).toHaveBeenCalledTimes(1);
  });

  it("videoAutoplay:false 时悬停只恢复加载源,不恢复 autoplay 属性", () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    v.setAttribute("autoplay", "");
    document.body.append(v);

    createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps()).track(v);
    v.dispatchEvent(new Event("pointerenter"));
    expect(v.getAttribute("src")).toContain(PARAM_PLAY);
    expect(v.hasAttribute("autoplay")).toBe(false);
  });

  it("after-lcp:不在视口且无 IntersectionObserver 时直接放行,不停在占位", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.stubGlobal("IntersectionObserver", undefined);
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    v.setAttribute("autoplay", "");
    v.getBoundingClientRect = () => ({ top: 9999, bottom: 10099, left: 0, right: 100, width: 100, height: 100, x: 0, y: 9999, toJSON: () => ({}) }) as DOMRect;
    document.body.append(v);

    createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: "after-lcp", videoAutoplayDelay: 5 }), inertDeps()).track(v);
    await flush(20);
    expect(v.getAttribute("src")).toContain(PARAM_PLAY);
  });

  it("接管期间应用改写了 src/<source>:还原时以当前值为准", () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    const source = document.createElement("source");
    source.setAttribute("src", "https://a.com/old.webm");
    v.append(source);
    document.body.append(v);

    createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps()).track(v);
    v.setAttribute("src", "https://a.com/new.mp4");
    source.setAttribute("src", "https://a.com/new.webm");
    v.dispatchEvent(new Event("pointerenter"));
    expect(v.getAttribute("src")).toContain("new.mp4");
    expect(v.getAttribute("src")).not.toContain("hero.mp4");
    expect(source.getAttribute("src")).toContain("new.webm");
    expect(source.getAttribute("src")).toContain(PARAM_PLAY);
  });

  it("接管期间新增/替换 <source>:还原后新节点带播放标记,快照中被移除的节点不回填", () => {
    const v = document.createElement("video");
    const kept = document.createElement("source");
    kept.setAttribute("src", "https://a.com/kept.webm");
    const removed = document.createElement("source");
    removed.setAttribute("src", "https://a.com/removed.webm");
    v.append(kept, removed);
    document.body.append(v);

    createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps()).track(v);
    removed.remove();
    const added = document.createElement("source");
    added.setAttribute("src", "https://a.com/added.mp4");
    v.append(added);
    v.dispatchEvent(new Event("pointerenter"));

    expect(added.getAttribute("src")).toContain("added.mp4");
    expect(added.getAttribute("src")).toContain(PARAM_PLAY);
    expect(kept.getAttribute("src")).toContain("kept.webm"); // 回填快照
    expect(kept.getAttribute("src")).toContain(PARAM_PLAY);
    expect(removed.hasAttribute("src")).toBe(false);
  });

  it("stop() 后 play 补丁被清掉(回到原型方法),意图监听也已取消", () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    document.body.append(v);

    const facade = createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps());
    facade.track(v);
    expect(Object.hasOwn(v, "play")).toBe(true); // 接管期间有补丁
    facade.stop();
    expect(Object.hasOwn(v, "play")).toBe(false);
    // 监听已 abort:换回占位后再触发手势,不会再被重复还原改写
    v.setAttribute("src", "https://a.com/other.mp4");
    v.dispatchEvent(new Event("pointerenter"));
    expect(v.getAttribute("src")).toBe("https://a.com/other.mp4");
  });

  it("接管前已有 own play:还原时写回原值", () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    const custom = (() => Promise.resolve()) as HTMLVideoElement["play"];
    v.play = custom;
    document.body.append(v);

    const facade = createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps());
    facade.track(v);
    facade.stop();
    expect(Object.getOwnPropertyDescriptor(v, "play")?.value).toBe(custom);
  });

  it("stop() 还原所有被管理元素", () => {
    const v = document.createElement("video");
    v.setAttribute("src", VIDEO_URL);
    document.body.append(v);

    const facade = createVideoFacade(resolveVideoOptions({ videoFrame: false, videoAutoplay: false }), inertDeps());
    facade.track(v);
    facade.stop();
    expect(v.getAttribute("src")).toContain(PARAM_PLAY);
  });
});
