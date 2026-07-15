/**
 * SW-side pipeline: request gating, threshold/sniff state machine,
 * placeholder response, background download + cache + notify, in-flight dedupe.
 *
 * SW 端管线:请求过滤、阈值/嗅探状态机、占位响应、后台下载+缓存+通知、并发去重。
 */

import { ByteAccumulator } from "../shared/bytes";
import { HEADER_MARK, PARAM_BYPASS, PARAM_FULL, type PicmanMessage, type PicmanStage, stripPicmanParams } from "../shared/protocol";
import { sniff } from "../shared/sniff";
import type { PicmanErrorContext, ResolvedSWOptions } from "../shared/types";
import { apngFirstFrame } from "../shared/walkers/apng";
import { gifFirstFrame } from "../shared/walkers/gif";
import { webpFirstFrame } from "../shared/walkers/webp";
import type { PicmanCacheLike } from "./cache";
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
  cache: PicmanCacheLike;
  /** Notify controlled pages — 通知受控页面 */
  notify: (msg: PicmanMessage) => void;
  /** First-frame bytes → placeholder PNG blob; null on unsupported/failure — 首帧字节 → 占位 PNG blob;不支持/失败为 null */
  makeFirstFrame: (bytes: Uint8Array, mime: string) => Promise<Blob | null>;
  /** Extend the fetch event lifetime for background work — 延长 fetch 事件生命周期以完成后台工作 */
  waitUntil: (p: Promise<unknown>) => void;
  /** Resolved SW options — 已解析的 SW 配置 */
  options: ResolvedSWOptions;
}

/** In-flight main-flow downloads keyed by canonical URL, for de-duplication — 按规范化 URL 去重的进行中下载 */
const inflight = new Map<string, Promise<Response>>();

/**
 * Synchronous pre-check: should this request be handed to picman?
 *
 * 同步预判:该请求是否交给 picman 处理。
 * @param request - Incoming fetch request — 拦截到的请求
 * @param options - Resolved SW options — 已解析的 SW 配置
 * @returns Whether to intercept — 是否拦截
 */
export function shouldIntercept(request: Request, options: ResolvedSWOptions): boolean {
  if (request.method !== "GET") return false;
  if ((request as unknown as { destination?: string }).destination !== "image") return false;

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
async function background(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  acc: ByteAccumulator,
  initialSniff: ReturnType<typeof sniff>,
  url: string,
  origResp: Response,
  deps: PipelineDeps,
): Promise<void> {
  let firstFrameDone = false;
  let currentSniff = initialSniff;

  try {
    while (true) {
      if (!firstFrameDone && acc.length <= deps.options.firstFrameMaxBytes) {
        const bytes = tryRecomposeFirstFrame(currentSniff, acc.view());
        if (bytes) {
          const blob = await deps.makeFirstFrame(bytes, currentSniff.mime!);
          if (blob) {
            await deps.cache.putStage(url, "ff", new Response(blob, { headers: { "Content-Type": currentSniff.mime! } }));
            deps.notify({ picman: 1, type: "first-frame", url });
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
    deps.notify({ picman: 1, type: "complete", url });
  } catch (err) {
    deps.notify({ picman: 1, type: "error", url, stage: "download", message: String(err) });
    const ctx: PicmanErrorContext = { url, stage: "download", error: err };
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
  const resp = await deps.fetchImpl(request);
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
        return new Response(concatStream(acc.view().slice(), reader), { headers: resp.headers });
      }

      if (sr.status === "animated" && sr.width !== undefined && sr.height !== undefined) {
        const svg = svgColorBlock({
          width: sr.width,
          height: sr.height,
          palette: sr.palette,
          mode: deps.options.colorBlock,
          fallbackColor: deps.options.fallbackColor,
        });
        deps.waitUntil(background(reader, acc, sr, request.url, resp, deps));
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

    if (url.searchParams.has(PARAM_BYPASS)) {
      return deps.fetchImpl(stripPicmanParams(request.url));
    }

    if (url.searchParams.has(PARAM_FULL)) {
      const stage = url.searchParams.get(PARAM_FULL) as PicmanStage;
      const strip = stripPicmanParams(request.url);
      const cached = await deps.cache.matchStage(strip, stage);
      if (cached) return cached;
      return deps.fetchImpl(strip);
    }

    const key = stripPicmanParams(request.url);
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
    const ctx: PicmanErrorContext = { url: request.url, stage: "fetch", error: err };
    deps.options.onError(ctx);
    return deps.fetchImpl(request);
  }
}
