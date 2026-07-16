/**
 * Explicit page-side API: request a URL's progressive load and observe its stages.
 *
 * 页面端显式 API:发起某个 URL 的渐进加载并观察其各阶段。
 */

import { withStageParam } from "../shared/protocol";
import { scheduleIdle } from "./idle";
import { _getContainer, subscribe } from "./messages";

/**
 * A single in-flight (or already-settled) progressive load.
 *
 * 一次进行中(或已结束)的渐进加载。
 */
export interface PicmanTask {
  /** Canonical original URL — 规范化原始 URL */
  url: string;
  /** Register a stage callback; returns this task for chaining — 注册阶段回调,返回自身以便链式调用 */
  onStage(cb: (stage: "placeholder" | "first-frame" | "complete", displayUrl: string) => void): PicmanTask;
  /** Resolves with the full-image display URL; rejects on download failure — 全图就绪后 resolve 显示 URL;下载失败 reject */
  done: Promise<string>;
}

/**
 * Start (or attach to) a progressive load for one image URL.
 *
 * 发起(或附着到)一次图片 URL 的渐进加载。
 * @param url - Image URL, absolute or relative to the current page — 图片 URL,绝对或相对当前页面
 * @returns A task exposing stage events and a completion promise — 暴露阶段事件与完成 Promise 的任务对象
 * @example
 * const task = load(img.src).onStage((stage, displayUrl) => { img.src = displayUrl })
 * await task.done
 */
export function load(url: string): PicmanTask {
  const canonical = new URL(url, location.href).href;
  const stageCbs: ((stage: "placeholder" | "first-frame" | "complete", displayUrl: string) => void)[] = [];

  let resolveDone!: (v: string) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<string>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  // Prevent Node/browser "unhandled rejection" reporting when a caller
  // never attaches its own .catch (e.g. a task left dangling past its
  // relevant URL's lifetime) — real rejections still reach any handler
  // the caller does attach, since this is an additional listener, not a
  // replacement.
  //
  // 防止调用方未挂 .catch 时触发"未处理拒绝"报告(如任务在其 URL 生命周期外被搁置);
  // 调用方自己挂的处理器仍会正常收到拒绝,因为这只是附加监听,不是替换。
  done.catch(() => {});

  const emit = (stage: "placeholder" | "first-frame" | "complete", displayUrl: string) => {
    for (const cb of stageCbs) cb(stage, displayUrl);
  };

  // De-dupe first-frame emission: it can arrive twice (once from a live SW
  // notification, once from the cache-reconciliation check below) when a
  // download is still in flight but its first-frame stage already landed
  // in Cache Storage — harmless to the page (same URL, browser won't
  // re-decode), but pointless to fire twice.
  //
  // 首帧事件去重:当下载仍在进行、但首帧阶段已落盘 Cache Storage 时,可能同时收到
  // 来自 SW 实时通知和下方缓存对账两路"first-frame"(对页面无害——同一 URL 浏览器
  // 不会重新解码——但重复触发没有意义)。
  let firstFrameEmitted = false;
  const emitFirstFrameOnce = (displayUrl: string) => {
    if (firstFrameEmitted) return;
    firstFrameEmitted = true;
    emit("first-frame", displayUrl);
  };

  const task: PicmanTask = {
    url: canonical,
    onStage(cb) {
      stageCbs.push(cb);
      return task;
    },
    done,
  };

  const container = _getContainer();
  if (!container?.controller) {
    queueMicrotask(() => {
      emit("complete", canonical);
      resolveDone(canonical);
    });
    return task;
  }

  // Whether cache/completion is already resolved data-wise is separate from
  // when the *page* gets to see it — real content (first-frame/complete) is
  // always held back to the next idle window (past the LCP) regardless of
  // whether it arrived via a live SW notification or a cache hit, so a
  // repeat visit's instant cache hit can never win a race against the LCP.
  //
  // "数据层面已经就绪"与"页面何时看到它"是两回事——无论真实内容(首帧/完整)
  // 是通过 SW 实时通知还是缓存命中拿到的,一律拖到下一个空闲窗口(LCP 之后)才真正
  // 交给页面,这样重复访问时的瞬间缓存命中永远不会抢在 LCP 前面。
  const unsubscribe = subscribe(canonical, (e) => {
    if (e.type === "first-frame") {
      const ffUrl = withStageParam(canonical, "ff");
      scheduleIdle(() => emitFirstFrameOnce(ffUrl));
    } else if (e.type === "complete") {
      const full = withStageParam(canonical, "1");
      unsubscribe();
      scheduleIdle(() => {
        emit("complete", full);
        resolveDone(full);
      });
    } else {
      unsubscribe();
      rejectDone(new Error(e.message ?? "picman download failed"));
    }
  });

  queueMicrotask(() => emit("placeholder", canonical));

  // Reconciliation: a prior download may already sit in Cache Storage (e.g.
  // after an SW restart lost the in-memory notification path, or simply a
  // repeat visit to an already-cached image). Checked in two ordered steps
  // rather than one — jumping straight to the full (often multi-frame,
  // heavier-to-decode) bytes on every repeat visit would make a
  // cache-hit *slower to paint* than showing the small pre-rendered
  // first-frame first, which matters when this image is the page's LCP
  // candidate: decode cost, not network latency, is what's on the critical
  // path once bytes are already local.
  //
  // 对账:此前的下载可能已在 Cache Storage 中(如 SW 重启丢失了内存态通知,或单纯是
  // 重复访问已缓存过的图片)。分两步按顺序检查,而非一步到位——每次重复访问都直接跳到
  // 完整字节(往往是解码更重的多帧内容),会让"缓存命中"反而比先显示预渲染的小首帧更晚
  // 完成首次绘制;当这张图是页面的 LCP 候选元素时,字节已在本地后,卡在关键路径上的是
  // 解码成本,不是网络延迟。
  if (typeof caches !== "undefined") {
    void reconcileFromCache(
      canonical,
      (ffUrl) => scheduleIdle(() => emitFirstFrameOnce(ffUrl)),
      (full) => {
        unsubscribe();
        scheduleIdle(() => {
          emit("complete", full);
          resolveDone(full);
        });
      },
    );
  }

  return task;
}

/**
 * Await both cache lookups in order (first-frame, then full) so a cached
 * first-frame always gets a chance to paint before the (often heavier to
 * decode) full bytes replace it.
 *
 * 按顺序 await 两次缓存查询(先首帧后完整),确保已缓存的首帧总能先绘制一次,
 * 再被(往往解码更重的)完整字节替换。
 * @param canonical - Canonical image URL — 规范化图片 URL
 * @param onFirstFrameHit - Called with the ff-stage URL when cached — 首帧阶段缓存命中时调用,传入其 URL
 * @param onCompleteHit - Called with the full-stage URL when cached — 完整阶段缓存命中时调用,传入其 URL
 */
async function reconcileFromCache(canonical: string, onFirstFrameHit: (url: string) => void, onCompleteHit: (url: string) => void): Promise<void> {
  try {
    const ffHit = await caches.match(withStageParam(canonical, "ff"));
    if (ffHit) onFirstFrameHit(withStageParam(canonical, "ff"));
  } catch {
    // Cache Storage access failing is non-fatal — 访问 Cache Storage 失败不致命
  }

  try {
    const hit = await caches.match(withStageParam(canonical, "1"));
    if (hit) onCompleteHit(withStageParam(canonical, "1"));
  } catch {
    // Cache Storage access failing is non-fatal — 访问 Cache Storage 失败不致命
  }
}
