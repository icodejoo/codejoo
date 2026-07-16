/**
 * Page-side `<video>` facade: neutralizes eager loading (autoplay/preload) so
 * video bytes don't compete for the LCP, shows a cover placeholder (poster if
 * present, else an instant color block optionally upgraded to a real first
 * frame off the critical path), and restores the true source on user intent or
 * — for autoplay videos — once the main thread goes idle past the LCP.
 *
 * 页面端 `<video>` 门面:中和贪婪加载(autoplay/preload),使视频字节不与 LCP 抢占;
 * 展示封面占位(有 poster 用 poster,否则先即时色块、可在关键路径外升级为真实首帧);
 * 在用户意图出现时、或对 autoplay 视频在主线程 LCP 之后空闲时,还原真实源。
 */

import { withPlayParam } from "../shared/protocol";
import { svgColorBlock, svgDataUri } from "../shared/placeholder";
import type { PicmanErrorContext } from "../shared/types";
import { scheduleIdle } from "./idle";

/** Fallback cover color when none is derivable — 无可推导颜色时的封面底色 */
const DEFAULT_COVER_COLOR = "#e0e0e0";
/** Fallback cover aspect (width:height) when the element has no size hints — 元素无尺寸提示时的封面比例 */
const DEFAULT_COVER = { width: 320, height: 180 };
/** Longest side of a grabbed first-frame cover, px — 抓取首帧封面的长边上限(像素) */
const MAX_COVER_SIDE = 512;

/**
 * Resolved video-facade options (the subset of {@link PicmanAutoOptions} this
 * module reads, with defaults already applied by {@link resolveVideoOptions}).
 *
 * 已解析的 video facade 配置(本模块读取的 {@link PicmanAutoOptions} 子集,默认值已由
 * {@link resolveVideoOptions} 应用)。
 */
export interface ResolvedVideoOptions {
  /** Try to grab a real first frame when no poster — 无 poster 时是否尝试抓真实首帧 */
  videoFrame: boolean;
  /** Range bytes fetched to grab a first frame — 抓首帧请求的 Range 字节数 */
  videoRangeBytes: number;
  /** Autoplay release strategy — autoplay 放行策略 */
  videoAutoplay: "after-lcp" | "immediate" | false;
  /** Upper bound (ms) for the after-lcp idle wait — after-lcp idle 等待上限(毫秒) */
  videoAutoplayDelay: number;
  /** Error hook — 错误钩子 */
  onError: (ctx: PicmanErrorContext) => void;
}

/**
 * Apply {@link PicmanAutoOptions} defaults for the fields this module needs.
 *
 * 为本模块所需字段应用 {@link PicmanAutoOptions} 默认值。
 * @param o - Partial video options — 部分视频配置
 * @returns Resolved video options — 解析后的视频配置
 */
export function resolveVideoOptions(o: Partial<ResolvedVideoOptions> = {}): ResolvedVideoOptions {
  return {
    videoFrame: o.videoFrame ?? true,
    videoRangeBytes: o.videoRangeBytes ?? 262144,
    videoAutoplay: o.videoAutoplay ?? "after-lcp",
    videoAutoplayDelay: o.videoAutoplayDelay ?? 2000,
    onError: o.onError ?? (() => {}),
  };
}

/**
 * Injectable dependencies for off-DOM first-frame grabbing, so the facade runs
 * identically in a browser and under test mocks.
 *
 * 离屏抓首帧的可注入依赖,使 facade 在浏览器与测试 mock 下行为一致。
 */
export interface VideoFrameDeps {
  /** Network fetch — 网络请求 */
  fetchImpl: typeof fetch;
  /** Create a detached <video> for decoding — 创建离屏解码用的 <video> */
  createVideo: () => HTMLVideoElement;
  /** Create a 2D canvas that can export a data URI — 创建可导出 dataURI 的 2D canvas */
  createCanvas: (w: number, h: number) => { getContext(id: "2d"): { drawImage(img: unknown, x: number, y: number, w: number, h: number): void } | null; toDataURL(type?: string, quality?: number): string };
}

/**
 * Build the default browser-backed frame deps (document/fetch based).
 *
 * 构造默认的浏览器实现帧依赖(基于 document/fetch)。
 * @returns Browser frame dependencies — 浏览器帧依赖
 */
function defaultFrameDeps(): VideoFrameDeps {
  return {
    fetchImpl: (...args) => fetch(...args),
    createVideo: () => document.createElement("video"),
    createCanvas: (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    },
  };
}

/** Saved original loading state of a managed <video> — 被管理 <video> 的原始加载状态 */
interface VideoOrigState {
  /** Original `src` attribute value — 原 `src` 属性值 */
  src: string | null;
  /** Original `<source>` children and their `src` — 原 `<source>` 子元素与其 `src` */
  sources: { el: HTMLSourceElement; src: string | null }[];
  /** Original `preload` attribute — 原 `preload` 属性 */
  preload: string | null;
  /** Whether the element was autoplay — 元素原本是否 autoplay */
  autoplay: boolean;
  /** Original `HTMLVideoElement.play` before patching — 打补丁前的原 `play` */
  origPlay: HTMLVideoElement["play"];
  /** Whether the true source has been restored — 是否已还原真实源 */
  restored: boolean;
}

/**
 * A running video facade over a scan root, exposing per-element tracking and a
 * stop function; created by {@link createVideoFacade} and driven by `auto()`.
 *
 * 作用于扫描根的运行中 video facade,暴露逐元素跟踪与停止函数;由 {@link createVideoFacade}
 * 创建、由 `auto()` 驱动。
 */
export interface VideoFacade {
  /** Start managing one `<video>` (idempotent) — 开始管理一个 `<video>`(幂等) */
  track(video: HTMLVideoElement): void;
  /** Restore every managed element and release resources — 还原所有被管理元素并释放资源 */
  stop(): void;
}

/**
 * Resolve `raw` against the current page into an absolute URL.
 *
 * 相对当前页面把 `raw` 解析为绝对 URL。
 * @param raw - Raw URL — 原始 URL
 * @returns Absolute URL — 绝对 URL
 */
function absolute(raw: string): string {
  return typeof location !== "undefined" ? new URL(raw, location.href).href : raw;
}

/**
 * Whether an element currently intersects the viewport (best-effort; treats a
 * zero-size layout, as in headless test envs, as visible).
 *
 * 元素当前是否与视口相交(尽力而为;把零尺寸布局——如无头测试环境——视为可见)。
 * @param el - Element to test — 待测元素
 * @returns Whether it is in view — 是否在视口内
 */
function inViewport(el: Element): boolean {
  if (typeof (el as HTMLElement).getBoundingClientRect !== "function" || typeof innerHeight === "undefined") return true;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return true;
  return r.top < innerHeight && r.bottom > 0;
}

/**
 * Compute the effective source URL a `<video>` would load (attribute `src`
 * first, then the first `<source>` with a `src`).
 *
 * 计算 `<video>` 会加载的有效源 URL(优先属性 `src`,否则第一个带 `src` 的 `<source>`)。
 * @param video - Video element — 视频元素
 * @returns Absolute source URL, or null when none — 绝对源 URL,无则 null
 */
function effectiveSource(video: HTMLVideoElement): string | null {
  const attr = video.getAttribute("src");
  if (attr) return absolute(attr);
  for (const s of video.querySelectorAll("source")) {
    const v = s.getAttribute("src");
    if (v) return absolute(v);
  }
  return null;
}

/**
 * Pick the cover placeholder dimensions from the element's size hints.
 *
 * 从元素的尺寸提示挑选封面占位尺寸。
 * @param video - Video element — 视频元素
 * @returns Cover width/height — 封面宽高
 */
function coverSize(video: HTMLVideoElement): { width: number; height: number } {
  const w = Number(video.getAttribute("width")) || 0;
  const h = Number(video.getAttribute("height")) || 0;
  if (w > 0 && h > 0) return { width: w, height: h };
  return DEFAULT_COVER;
}

/**
 * Wait until a detached `<video>` has its first frame decoded (or fail).
 *
 * 等待离屏 `<video>` 解出首帧(或失败)。
 * @param v - Detached video element — 离屏视频元素
 * @returns Resolves when a frame is available — 有帧可用时 resolve
 */
function waitFirstFrame(v: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    v.addEventListener("loadeddata", () => resolve(), { once: true });
    v.addEventListener("error", () => reject(new Error("video decode failed")), { once: true });
  });
}

/**
 * Grab a real first-frame cover off the critical path: Range-fetch the head,
 * decode via a detached blob-URL `<video>` (blob URLs are same-origin, so the
 * canvas is never tainted), and export a data URI. Returns null on any
 * failure — opaque response, decode error, or a SecurityError from a tainted
 * canvas — so the caller keeps the color-block cover.
 *
 * 在关键路径外抓取真实首帧封面:Range 拉取头部,经离屏 blob-URL `<video>` 解码
 * (blob URL 同源,canvas 绝不被污染),导出为 data URI。任何失败(opaque 响应、解码
 * 出错、污染 canvas 的 SecurityError)一律返回 null,调用方保留色块封面。
 * @param url - Absolute video URL — 绝对视频 URL
 * @param opts - Resolved video options — 已解析视频配置
 * @param deps - Injected frame dependencies — 注入的帧依赖
 * @returns Poster data URI, or null — poster data URI,或 null
 */
async function grabFrameCover(url: string, opts: ResolvedVideoOptions, deps: VideoFrameDeps): Promise<string | null> {
  let blob: Blob;
  try {
    const resp = await deps.fetchImpl(url, { mode: "cors", headers: { Range: `bytes=0-${opts.videoRangeBytes - 1}` } });
    if (resp.type === "opaque") return null;
    if (!resp.ok && resp.status !== 206) return null;
    blob = await resp.blob();
  } catch {
    return null;
  }

  const objectUrl = URL.createObjectURL(blob);
  const v = deps.createVideo();
  try {
    v.muted = true;
    v.preload = "auto";
    v.src = objectUrl;
    await waitFirstFrame(v);

    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;

    const scale = Math.min(1, MAX_COVER_SIDE / Math.max(vw, vh));
    const cw = Math.round(vw * scale);
    const ch = Math.round(vh * scale);
    const canvas = deps.createCanvas(cw, ch);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, cw, ch);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  } finally {
    v.removeAttribute("src");
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Create a video facade: manages `<video>` elements handed to `track()`,
 * neutralizing eager loads, applying cover placeholders, and restoring the true
 * source on user intent or the after-lcp autoplay schedule.
 *
 * 创建 video facade:管理交给 `track()` 的 `<video>`,中和贪婪加载、应用封面占位,并在
 * 用户意图或 after-lcp 自动播放时机还原真实源。
 * @param opts - Resolved video options — 已解析视频配置
 * @param deps - Frame dependencies, defaults to browser-backed — 帧依赖,默认浏览器实现
 * @returns A running facade — 运行中的 facade
 * @example
 * const facade = createVideoFacade(resolveVideoOptions({ videoAutoplay: 'after-lcp' }))
 * facade.track(document.querySelector('video')!)
 */
export function createVideoFacade(opts: ResolvedVideoOptions, deps: VideoFrameDeps = defaultFrameDeps()): VideoFacade {
  /** Managed elements → saved original state — 被管理元素 → 原始状态 */
  const states = new WeakMap<HTMLVideoElement, VideoOrigState>();
  /** Live managed elements, for stop() restore — 存活的被管理元素,供 stop() 还原 */
  const managed = new Set<WeakRef<HTMLVideoElement>>();

  /** Shared viewport observer for autoplay videos, lazily created — autoplay 视频共享的视口观察器,惰性创建 */
  let io: IntersectionObserver | null = null;

  /**
   * Restore one element's true source and (optionally) start playback.
   *
   * 还原某元素的真实源,并(可选)开始播放。
   * @param video - Managed element — 被管理元素
   * @param play - Whether to start playback — 是否开始播放
   */
  function restore(video: HTMLVideoElement, play: boolean): void {
    const st = states.get(video);
    if (!st || st.restored) return;
    st.restored = true;

    if (st.src !== null) video.setAttribute("src", withPlayParam(absolute(st.src)));
    for (const s of st.sources) {
      if (s.src !== null) s.el.setAttribute("src", withPlayParam(absolute(s.src)));
    }
    if (st.preload !== null) video.setAttribute("preload", st.preload);
    else video.removeAttribute("preload");
    if (st.autoplay) video.setAttribute("autoplay", "");

    video.load();

    if (play) {
      const p = st.origPlay.call(video);
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  }

  /**
   * Ensure the shared viewport observer exists.
   *
   * 确保共享视口观察器已创建。
   */
  function ensureObserver(): void {
    if (io || typeof IntersectionObserver === "undefined") return;
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const v = e.target as HTMLVideoElement;
          io!.unobserve(v);
          restore(v, true);
        }
      }
    });
  }

  /**
   * Apply the cover placeholder: keep an existing poster, otherwise show an
   * instant color block and (when enabled) upgrade to a grabbed first frame.
   *
   * 应用封面占位:保留已有 poster,否则先上即时色块,并(启用时)升级为抓取的首帧。
   * @param video - Managed element — 被管理元素
   * @param url - Effective source URL — 有效源 URL
   */
  function applyCover(video: HTMLVideoElement, url: string | null): void {
    const posterAttr = video.getAttribute("poster");
    if (posterAttr) return; // 有 poster:零额外请求,直接用

    const { width, height } = coverSize(video);
    video.poster = svgDataUri(svgColorBlock({ width, height, mode: "gradient", fallbackColor: DEFAULT_COVER_COLOR }));

    if (!opts.videoFrame || !url) return;

    scheduleIdle(() => {
      grabFrameCover(url, opts, deps)
        .then((dataUri) => {
          if (dataUri && !states.get(video)?.restored) video.poster = dataUri;
        })
        .catch((error) => opts.onError({ url, stage: "video-frame", error }));
    }, 1);
  }

  /**
   * Neutralize an element's eager loading, saving original state for restore.
   *
   * 中和元素的贪婪加载,保存原始状态以便还原。
   * @param video - Element to neutralize — 待中和元素
   * @returns Saved state — 已保存状态
   */
  function neutralize(video: HTMLVideoElement): VideoOrigState {
    const sources = Array.from(video.querySelectorAll("source")).map((el) => ({ el, src: el.getAttribute("src") }));
    const st: VideoOrigState = {
      src: video.getAttribute("src"),
      sources,
      preload: video.getAttribute("preload"),
      autoplay: video.autoplay || video.hasAttribute("autoplay"),
      origPlay: video.play.bind(video),
      restored: false,
    };

    video.removeAttribute("src");
    for (const s of sources) s.el.removeAttribute("src");
    video.setAttribute("preload", "none");
    video.removeAttribute("autoplay");
    video.load();

    // Patch play() so programmatic playback restores the true source first.
    // 打补丁:程序化播放先还原真实源。
    video.play = () => {
      restore(video, false);
      return st.origPlay.call(video);
    };

    return st;
  }

  function track(video: HTMLVideoElement): void {
    if (states.has(video)) return;

    const isAutoplay = video.autoplay || video.hasAttribute("autoplay");
    // 'immediate' 表示不接管 autoplay 视频,保持原生行为。
    if (isAutoplay && opts.videoAutoplay === "immediate") return;

    const url = effectiveSource(video);
    const st = neutralize(video);
    states.set(video, st);
    managed.add(new WeakRef(video));

    applyCover(video, url);

    // 用户意图:悬停/按下/聚焦即还原(仅加载,不强制播放)。
    const onIntent = (): void => restore(video, false);
    for (const type of ["pointerenter", "pointerdown", "focus"] as const) {
      video.addEventListener(type, onIntent, { once: true });
    }

    // autoplay 视频:after-lcp 在主线程空闲(LCP 之后)放行;false 时也只等手势。
    if (isAutoplay && opts.videoAutoplay === "after-lcp") {
      scheduleIdle(() => {
        if (states.get(video)?.restored) return;
        if (inViewport(video)) restore(video, true);
        else {
          ensureObserver();
          io?.observe(video);
        }
      }, opts.videoAutoplayDelay);
    }
  }

  function stop(): void {
    io?.disconnect();
    io = null;
    for (const ref of managed) {
      const v = ref.deref();
      if (v) restore(v, false);
    }
    managed.clear();
  }

  return { track, stop };
}
