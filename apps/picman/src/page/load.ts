/**
 * Explicit page-side API: request a URL's progressive load and observe its stages.
 *
 * 页面端显式 API:发起某个 URL 的渐进加载并观察其各阶段。
 */

import { withStageParam } from "../shared/protocol";
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

  const unsubscribe = subscribe(canonical, (e) => {
    if (e.type === "first-frame") {
      emit("first-frame", withStageParam(canonical, "ff"));
    } else if (e.type === "complete") {
      const full = withStageParam(canonical, "1");
      emit("complete", full);
      resolveDone(full);
      unsubscribe();
    } else {
      rejectDone(new Error(e.message ?? "picman download failed"));
      unsubscribe();
    }
  });

  queueMicrotask(() => emit("placeholder", canonical));

  // Reconciliation: a prior completed download may already sit in Cache Storage
  // (e.g. after an SW restart lost the in-memory notification path).
  // 对账:此前的完整下载可能已在 Cache Storage 中(如 SW 重启丢失了内存态通知)。
  if (typeof caches !== "undefined") {
    caches
      .match(withStageParam(canonical, "1"))
      .then((hit) => {
        if (hit) {
          const full = withStageParam(canonical, "1");
          emit("complete", full);
          resolveDone(full);
          unsubscribe();
        }
      })
      .catch(() => {});
  }

  return task;
}
