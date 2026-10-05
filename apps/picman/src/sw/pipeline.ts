/**
 * SW-side pipeline: request gating, threshold/sniff state machine,
 * placeholder response, background download + cache + notify, in-flight dedupe.
 *
 * SW 端管线:请求过滤、阈值/嗅探状态机、占位响应、后台下载+缓存+通知、并发去重。
 */

import { ByteAccumulator } from "../shared/bytes";
import { HEADER_MARK, PARAM_BYPASS, PARAM_FULL, PARAM_PLAY, PARAM_SKE, type ImgprogressMessage, type ImgprogressStage, stripImgprogressParams } from "../shared/protocol";
import { sniff } from "../shared/sniff";
import type { ImgprogressErrorContext, ResolvedSWOptions } from "../shared/types";
import { apngFirstFrame } from "../shared/walkers/apng";
import { avifFirstFrame } from "../shared/walkers/avif";
import { gifFirstFrame } from "../shared/walkers/gif";
import { webpFirstFrame } from "../shared/walkers/webp";
import type { ImgprogressCacheLike } from "./cache";
import { svgColorBlock } from "./placeholder";

/**
 * Dependencies injected into the pipeline (real SW globals, or test mocks).
 *
 * 注入管线的依赖(真实 SW 全局对象,或测试 mock)。
 */
export interface PipelineDeps {
  /** Network fetch — 网络请求 */
  fetchImpl: typeof fetch;
  /** Stage-keyed cache — 按阶段分 key 的缓存 */
  cache: ImgprogressCacheLike;
  /**
   * Notify controlled pages. Must be awaited by callers — postMessage to a
   * Client is cross-process and takes real (if small) time; if this isn't
   * awaited inside the same async chain that `waitUntil()` is extending, the
   * SW can be recycled by the browser before the message actually lands,
   * silently dropping it.
   *
   * 通知受控页面。调用方必须 await——给 Client 的 postMessage 是跨进程的,需要真实
   * (虽然很短)的时间;若不在 `waitUntil()` 延长的同一条异步链里 await 它,浏览器可能
   * 在消息真正投递前就回收 SW,导致消息静默丢失。
   */
  notify: (msg: ImgprogressMessage) => Promise<void>;
  /** First-frame bytes → placeholder PNG blob; null on unsupported/failure — 首帧字节 → 占位 PNG blob;不支持/失败为 null */
  makeFirstFrame: (bytes: Uint8Array, mime: string) => Promise<Blob | null>;
  /** Extend the fetch event lifetime for background work — 延长 fetch 事件生命周期以完成后台工作 */
  waitUntil: (p: Promise<unknown>) => void;
  /** Resolved SW options — 已解析的 SW 配置 */
  options: ResolvedSWOptions;
}

/** In-flight main-flow downloads keyed by canonical URL, for de-duplication — 按规范化 URL 去重的进行中下载 */
const inflight = new Map<string, Promise<Response>>();

/** Memoized static color blocks, keyed by `color|mode|WxH` — 静态色块记忆缓存,按 `颜色|样式|宽x高` 键存 */
const colorBlockCache = new Map<string, string>();

/**
 * Get a static color-block SVG, generated once per (color, mode, size) and
 * reused thereafter. No per-request palette extraction and no per-request
 * rebuild — the block is content-independent, so identical (color, mode, size)
 * requests share the same precomputed markup.
 *
 * 取静态色块 SVG,按(颜色,样式,尺寸)只生成一次、之后复用。不再逐请求取色、逐请求重建——
 * 色块与图片内容无关,故相同(颜色,样式,尺寸)的请求共享同一份预生成字符串。
 * @param width - Block width — 色块宽
 * @param height - Block height — 色块高
 * @param color - Hex skeleton color — 十六进制骨架色
 * @param mode - Solid fill or vertical gradient — 纯色或纵向渐变
 * @returns SVG markup — SVG 字符串
 */
function getColorBlock(width: number, height: number, color: string, mode: "solid" | "gradient"): string {
  const key = `${color}|${mode}|${width}x${height}`;
  let svg = colorBlockCache.get(key);
  if (svg === undefined) {
    svg = svgColorBlock({ width, height, mode, fallbackColor: color });
    colorBlockCache.set(key, svg);
  }
  return svg;
}

/**
 * Synchronous pre-check: should this request be handed to imgprogress?
 *
 * 同步预判:该请求是否交给 imgprogress 处理。
 * @param request - Incoming fetch request — 拦截到的请求
 * @param options - Resolved SW options — 已解析的 SW 配置
 * @returns Whether to intercept — 是否拦截
 */
export function shouldIntercept(request: Request, options: ResolvedSWOptions): boolean {
  if (request.method !== "GET") return false;

  const destination = (request as unknown as { destination?: string }).destination;

  // Video fallback gate: a play-marked request is a real user play → native
  // passthrough (preserves Range/206/seek); otherwise defer only when opted in.
  // 视频兜底门控:带播放标记 = 真实用户播放 → 原生透传(保留 Range/206/seek);否则仅在 opt-in 时延迟。
  if (destination === "video") {
    const parsed = new URL(request.url);
    if (parsed.searchParams.has(PARAM_PLAY)) return false;
    return options.deferVideos;
  }

  if (destination !== "image") return false;

  const url = request.url;
  const parsed = new URL(url);
  if (parsed.searchParams.has(PARAM_FULL) || parsed.searchParams.has(PARAM_BYPASS)) return true;

  const matches = (rules: (string | RegExp)[]) => rules.some((r) => (typeof r === "string" ? url.includes(r) : r.test(url)));
  if (matches(options.exclude)) return false;
  if (!matches(options.include)) return false;
  return true;
}

/**
 * Build a stream that replays already-buffered bytes before continuing to
 * pump the rest of an in-progress reader.
 *
 * 构造一个流:先回放已缓冲字节,再继续泵送进行中的 reader 剩余数据。
 * @param prefix - Already-buffered bytes — 已缓冲字节
 * @param reader - Remaining body reader — 剩余的响应体 reader
 * @returns Combined stream — 拼接后的流
 */
function concatStream(prefix: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  let sentPrefix = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentPrefix) {
        sentPrefix = true;
        if (prefix.length > 0) {
          controller.enqueue(prefix);
          return;
        }
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
  });
}

/**
 * Recompose the first-frame bytes for a confirmed-animated sniff result,
 * dispatching to the matching format's recomposer.
 *
 * 为已确认动图的嗅探结果重组首帧字节,分派到对应格式的重组器。
 * @param sr - Sniff result (must be format-tagged) — 嗅探结果(须已带格式标记)
 * @param bytes - Accumulated bytes so far — 目前已累积的字节
 * @returns First-frame bytes, or null when not ready/unsupported — 首帧字节,未就绪/不支持时为 null
 */
function tryRecomposeFirstFrame(sr: ReturnType<typeof sniff>, bytes: Uint8Array): Uint8Array | null {
  if (sr.format === "gif" && sr.gifFirstFrameEnd !== undefined) return gifFirstFrame(bytes, sr.gifFirstFrameEnd);
  if (sr.format === "apng" && sr.apngFirstFrameReady) return apngFirstFrame(bytes);
  if (sr.format === "webp" && sr.webpAnmf !== undefined) return webpFirstFrame(bytes, sr.webpAnmf);
  if (sr.format === "avif" && sr.avifFirstSample && sr.avifAv1C && sr.width !== undefined && sr.height !== undefined) {
    // Unlike GIF/APNG/WebP (whose first-frame boundary is always within the
    // already-scanned prefix), AVIF's sample offset comes from `moov`, which
    // can resolve before the referenced `mdat` bytes have actually arrived —
    // so an explicit length check is required here (the other formats get
    // this for free from their linear/sequential parsing).
    //
    // 不同于 GIF/APNG/WebP(首帧边界恒在已扫描前缀内),AVIF 的样本偏移来自 moov,
    // 可能在其指向的 mdat 字节真正到达前就已解出——所以这里需要显式长度检查
    // (其他格式因为是线性顺序解析,这个保证是免费的)。
    const { offset, size } = sr.avifFirstSample;
    if (bytes.length < offset + size) return null;
    return avifFirstFrame(bytes.subarray(offset, offset + size), sr.avifAv1C, sr.width, sr.height);
  }
  return null;
}

/**
 * Continue downloading in the background: emit the first-frame placeholder
 * once ready, then cache the full image and notify pages.
 *
 * 后台继续下载:首帧就绪即产出占位,全图下载完成后写缓存并通知页面。
 * @param reader - Body reader positioned after the buffered prefix — 定位在已缓冲前缀之后的 body reader
 * @param acc - Accumulator already holding the buffered prefix — 已持有缓冲前缀的累积器
 * @param initialSniff - Sniff result that confirmed 'animated' — 确认 'animated' 时的嗅探结果
 * @param url - Canonical image URL — 规范化图片 URL
 * @param origResp - Original network response, for header reuse — 原始网络响应,用于复用响应头
 * @param deps - Pipeline dependencies — 管线依赖
 */
async function background(reader: ReadableStreamDefaultReader<Uint8Array>, acc: ByteAccumulator, initialSniff: ReturnType<typeof sniff>, url: string, origResp: Response, deps: PipelineDeps): Promise<void> {
  let firstFrameDone = false;
  let currentSniff = initialSniff;

  try {
    while (true) {
      if (!firstFrameDone && acc.length <= deps.options.firstFrameMaxBytes) {
        const bytes = tryRecomposeFirstFrame(currentSniff, acc.view());
        if (bytes) {
          const blob = await deps.makeFirstFrame(bytes, currentSniff.mime!);
          if (blob) {
            // makeFirstFrame always rasterizes to a PNG blob regardless of the
            // source format (see makeFirstFramePlaceholder's canvas.convertToBlob),
            // so the cached response's Content-Type must be 'image/png' — reusing
            // the original format's mime here would mismatch the actual bytes.
            //
            // makeFirstFrame 无论源格式是什么,始终光栅化为 PNG blob(见
            // makeFirstFramePlaceholder 的 canvas.convertToBlob),所以缓存响应的
            // Content-Type 必须是 'image/png'——沿用原始格式的 mime 会与实际字节不符。
            await deps.cache.putStage(url, "ff", new Response(blob, { headers: { "Content-Type": "image/png" } }));
            await deps.notify({ imgprogress: 1, type: "first-frame", url });
          } else {
            deps.options.onError({ url, stage: "first-frame", error: new Error("first-frame render returned null") });
          }
          firstFrameDone = true;
        }
      }

      const { done, value } = await reader.read();
      if (value) acc.append(value);
      if (done) break;
      if (!firstFrameDone) currentSniff = sniff(acc.view());
    }

    await deps.cache.putStage(url, "1", new Response(acc.view().slice(), { headers: origResp.headers }));
    await deps.notify({ imgprogress: 1, type: "complete", url });
  } catch (err) {
    await deps.notify({ imgprogress: 1, type: "error", url, stage: "download", message: String(err) });
    const ctx: ImgprogressErrorContext = { url, stage: "download", error: err };
    deps.options.onError(ctx);
  }
}

/**
 * Static-progressive background, encoding-aware two-path thumbnail:
 * - Full-coverage encodings (progressive JPEG / interlaced PNG): the moment
 *   the stream crosses the per-image "displayable" signal (see {@link sniff}'s
 *   `staticDisplayable`), cache the raw prefix bytes as the 'ff' stage — the
 *   page's tolerant `<img>` decoder shows a whole-image blurry/mosaic preview
 *   long before the download finishes.
 * - Baseline JPEG / non-interlaced PNG: truncated bytes decode to a top slice
 *   only (not worth showing), so wait for the full download and rasterize a
 *   downscaled thumbnail via makeFirstFrame instead.
 * Then cache the full image either way.
 *
 * 静态渐进后台,编码感知的双路径缩略图:
 * - 全图覆盖编码(渐进式 JPEG / 隔行 PNG):字节流一越过该图自己的"可显示"信号(见
 *   {@link sniff} 的 `staticDisplayable`),就把已到原始前缀字节缓存为 'ff' 阶段——
 *   页面 `<img>` 宽容解码器在下载远未完成时就能显示全图模糊/马赛克预览。
 * - baseline JPEG / 非隔行 PNG:截断字节只能解出顶部一条(不值得展示),改为等全量
 *   下载完,用 makeFirstFrame 光栅化一张降采样缩略图。
 * 两条路径最后都缓存完整图。
 * @param reader - Body reader positioned after the buffered prefix — 定位在已缓冲前缀之后的 body reader
 * @param acc - Accumulator already holding the buffered prefix — 已持有缓冲前缀的累积器
 * @param initialSniff - Sniff result at handoff — 交接时的嗅探结果
 * @param url - Canonical image URL — 规范化图片 URL
 * @param origResp - Original network response, for header reuse — 原始网络响应,用于复用响应头
 * @param deps - Pipeline dependencies — 管线依赖
 */
async function backgroundStatic(reader: ReadableStreamDefaultReader<Uint8Array>, acc: ByteAccumulator, initialSniff: ReturnType<typeof sniff>, url: string, origResp: Response, deps: PipelineDeps): Promise<void> {
  const mime = initialSniff.mime!;
  let thumbDone = false;

  const putPrefixThumb = async (): Promise<void> => {
    await deps.cache.putStage(url, "ff", new Response(acc.view().slice(), { headers: { "Content-Type": mime } }));
    await deps.notify({ imgprogress: 1, type: "first-frame", url });
    thumbDone = true;
  };

  try {
    if (initialSniff.staticDisplayable) await putPrefixThumb();

    while (true) {
      const { done, value } = await reader.read();
      if (value) acc.append(value);
      if (done) break;
      if (!thumbDone && sniff(acc.view()).staticDisplayable) await putPrefixThumb();
    }

    // Baseline path: no early signal fired — rasterize a downscaled thumbnail
    // from the now-complete bytes (worker-side decode, off the main thread).
    // baseline 路径:早期信号未触发——用已完整的字节光栅化降采样缩略图(worker 线程解码,不占主线程)。
    if (!thumbDone) {
      const blob = await deps.makeFirstFrame(acc.view(), mime);
      if (blob) {
        await deps.cache.putStage(url, "ff", new Response(blob, { headers: { "Content-Type": "image/png" } }));
        await deps.notify({ imgprogress: 1, type: "first-frame", url });
      }
    }

    await deps.cache.putStage(url, "1", new Response(acc.view().slice(), { headers: origResp.headers }));
    await deps.notify({ imgprogress: 1, type: "complete", url });
  } catch (err) {
    await deps.notify({ imgprogress: 1, type: "error", url, stage: "download", message: String(err) });
    const ctx: ImgprogressErrorContext = { url, stage: "download", error: err };
    deps.options.onError(ctx);
  }
}

/**
 * Main download flow: threshold check, streaming sniff, placeholder + background handoff.
 *
 * 主下载流程:阈值判断、流式嗅探、占位响应 + 后台交接。
 * @param request - Original request — 原始请求
 * @param deps - Pipeline dependencies — 管线依赖
 * @returns Response to hand back to the page — 回给页面的响应
 */
async function mainFlow(request: Request, deps: PipelineDeps): Promise<Response> {
  // 骨架色:优先用本请求携带的按元素 data-ske-color(经 PARAM_SKE),否则用全局静态默认色。
  // Skeleton color: prefer this request's per-element data-ske-color (via PARAM_SKE), else the global static default.
  const ske = new URL(request.url).searchParams.get(PARAM_SKE);
  const color = ske ?? deps.options.fallbackColor;

  // 规范化 URL 用于 fetch/缓存/通知——绝不能把 ske 等标记参数发给源站或写进 key,
  // 否则页面端(用规范 URL 订阅)会与通知对不上。无参数时沿用原 Request 保留语义。
  // Canonical URL for fetch/cache/notify — never leak marker params (ske, …) to the
  // origin or into the key, or the page (subscribed on the canonical URL) won't match
  // the notification. Reuse the original Request when there are no params, to preserve semantics.
  const canonical = stripImgprogressParams(request.url);
  const fetchReq = canonical === request.url ? request : new Request(canonical, request);

  const resp = await deps.fetchImpl(fetchReq);
  if (!resp.ok || resp.type === "opaque" || !resp.body) return resp;

  const cl = resp.headers.get("Content-Length");
  if (cl && Number(cl) < deps.options.threshold) return resp;

  const reader = resp.body.getReader();
  const acc = new ByteAccumulator();

  while (true) {
    const { done, value } = await reader.read();
    if (value) acc.append(value);

    if (!cl && done && acc.length < deps.options.threshold) {
      return new Response(acc.view().slice(), { status: resp.status, headers: resp.headers });
    }

    if (acc.length >= deps.options.headBytes || done) {
      const sr = sniff(acc.view());

      if (sr.status === "static") {
        // Large static PNG/JPEG with known dimensions: enter the static-
        // progressive flow (placeholder now, partial-bytes thumbnail when the
        // dynamic displayability signal fires, full image last) instead of a
        // plain passthrough. Unrecognized formats still pass through untouched.
        //
        // 已知尺寸的静态大图 PNG/JPEG:进入静态渐进流程(先占位,动态可显示信号触发时
        // 给部分字节缩略图,最后完整图),不再直接透传。未识别格式仍原样透传。
        if (deps.options.staticProgressive && (sr.format === "jpeg" || sr.format === "apng") && sr.width !== undefined && sr.height !== undefined && !done) {
          const svg = getColorBlock(sr.width, sr.height, color, deps.options.colorBlock);
          deps.waitUntil(backgroundStatic(reader, acc, sr, canonical, resp, deps));
          return new Response(svg, {
            headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", [HEADER_MARK]: "placeholder" },
          });
        }
        return new Response(concatStream(acc.view().slice(), reader), { headers: resp.headers });
      }

      if (sr.status === "animated" && sr.width !== undefined && sr.height !== undefined) {
        const svg = getColorBlock(sr.width, sr.height, color, deps.options.colorBlock);
        deps.waitUntil(background(reader, acc, sr, canonical, resp, deps));
        return new Response(svg, {
          headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", [HEADER_MARK]: "placeholder" },
        });
      }

      if (done) {
        // Stream ended without a conclusive result — hand back whatever arrived.
        // 流已结束但结论未定——原样交回已收到的数据。
        return new Response(acc.view().slice(), { headers: resp.headers });
      }
    }
  }
}

/**
 * Handle an intercepted image request end to end; never throws — any
 * failure degrades to a transparent network passthrough.
 *
 * 端到端处理被拦截的图片请求;绝不向外抛异常——任何失败都塌向透传原图。
 * @param request - Intercepted request — 被拦截的请求
 * @param deps - Pipeline dependencies — 管线依赖
 * @returns Response for the page — 回给页面的响应
 * @example
 * self.addEventListener('fetch', e => { if (shouldIntercept(e.request, o)) e.respondWith(handleImageRequest(e.request, deps)) })
 */
export async function handleImageRequest(request: Request, deps: PipelineDeps): Promise<Response> {
  try {
    const url = new URL(request.url);

    // Deferred video: reached only when deferVideos is on and the request
    // carries no play marker — starve it with a tiny response so no video
    // bytes download; the page-side facade re-requests with PARAM_PLAY on play.
    // 延迟视频:仅当 deferVideos 开启且请求无播放标记时到达——用极小响应"饿死"它,
    // 不下载任何视频字节;页面端 facade 会在播放时带 PARAM_PLAY 重新请求。
    if ((request as unknown as { destination?: string }).destination === "video") {
      return new Response(null, { status: 204, headers: { [HEADER_MARK]: "deferred", "Cache-Control": "no-store" } });
    }

    if (url.searchParams.has(PARAM_BYPASS)) {
      return deps.fetchImpl(stripImgprogressParams(request.url));
    }

    if (url.searchParams.has(PARAM_FULL)) {
      const stage = url.searchParams.get(PARAM_FULL) as ImgprogressStage;
      const strip = stripImgprogressParams(request.url);
      const cached = await deps.cache.matchStage(strip, stage);
      if (cached) return cached;
      return deps.fetchImpl(strip);
    }

    const key = stripImgprogressParams(request.url);

    // 需求2:统一行为——完整图已在缓存里就直接返回,跳过色块与重新下载(重复访问优化)。
    // Unify behavior: if the full image is already cached, serve it directly — skip the color block and the re-download (repeat-visit optimization).
    const cachedFull = await deps.cache.matchStage(key, "1");
    if (cachedFull) return cachedFull;

    const existing = inflight.get(key);
    if (existing) return (await existing).clone();

    const promise = mainFlow(request, deps);
    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  } catch (err) {
    const ctx: ImgprogressErrorContext = { url: request.url, stage: "fetch", error: err };
    deps.options.onError(ctx);
    return deps.fetchImpl(request);
  }
}
