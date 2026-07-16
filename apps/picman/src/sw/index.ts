/**
 * Self-assembly entry: wires install/activate/fetch listeners onto the
 * current Service Worker scope using real browser dependencies.
 *
 * 自装入口:用真实浏览器依赖,把 install/activate/fetch 监听器挂到当前 SW scope。
 */

import { resolveSWOptions } from "../shared/types";
import type { PicmanSWOptions } from "../shared/types";
import { PicmanCache } from "./cache";
import { handleImageRequest, shouldIntercept } from "./pipeline";
import { makeFirstFramePlaceholder } from "./placeholder";

/** Minimal ExtendableEvent surface (install/activate) — 最小 ExtendableEvent 接口(install/activate) */
interface ExtendableEventLike {
  waitUntil(p: Promise<unknown>): void;
}

/** Minimal FetchEvent surface — 最小 FetchEvent 接口 */
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(r: Promise<Response> | Response): void;
}

/** Minimal Client surface (a controlled page) — 最小 Client 接口(一个受控页面) */
interface ClientLike {
  postMessage(msg: unknown): void;
}

/**
 * Minimal Service Worker global scope surface this module depends on — kept
 * local instead of pulling in the "webworker" lib, which cannot coexist with
 * "dom" in one tsconfig.
 *
 * 本模块依赖的最小 Service Worker 全局 scope 接口——本地定义而非引入 "webworker" lib,
 * 因为它无法与同一 tsconfig 里的 "dom" 共存。
 */
interface ServiceWorkerScopeLike {
  addEventListener(type: "install", listener: (e: ExtendableEventLike) => void): void;
  addEventListener(type: "activate", listener: (e: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", listener: (e: FetchEventLike) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(opts: { type: string }): Promise<ClientLike[]> };
}

/**
 * Install the picman progressive-loading pipeline on the current Service
 * Worker scope: intercepts matching image requests, degrading to a normal
 * network passthrough for everything else.
 *
 * 在当前 Service Worker scope 上安装 picman 渐进加载管线:拦截匹配的图片请求,
 * 其余一律走原生网络透传。
 * @param options - SW-side pipeline options — SW 端管线配置
 * @example
 * // src/sw.ts in a consumer's own service worker
 * import { setupPicman } from '@codejoo/picman/sw'
 * setupPicman({ threshold: 200 * 1024 })
 */
export function setupPicman(options?: PicmanSWOptions): void {
  const o = resolveSWOptions(options);
  const cache = new PicmanCache(o.cache, caches);
  const scope = self as unknown as ServiceWorkerScopeLike;

  scope.addEventListener("install", () => scope.skipWaiting());
  scope.addEventListener("activate", (e) => e.waitUntil(scope.clients.claim()));

  scope.addEventListener("fetch", (e) => {
    if (!shouldIntercept(e.request, o)) return;
    e.respondWith(
      handleImageRequest(e.request, {
        fetchImpl: fetch.bind(scope),
        cache,
        // Must be awaited by callers (see PipelineDeps.notify) — postMessage to a
        // Client is cross-process; without waiting for clients.matchAll() and the
        // postMessage calls themselves inside the same async chain that
        // e.waitUntil() extends, the SW can be recycled before delivery completes,
        // silently dropping the notification (observed in practice with slower
        // first-frame decodes racing the browser's own preload-scanner timing).
        //
        // 调用方必须 await(见 PipelineDeps.notify)——给 Client 的 postMessage 是跨进程的;
        // 若不在 e.waitUntil() 延长的同一条异步链里等待 clients.matchAll() 和 postMessage
        // 本身完成,浏览器可能在投递完成前就回收 SW,导致通知静默丢失(实测中,首帧解码较慢、
        // 与浏览器自身预加载扫描器的时序竞争时会触发)。
        notify: (msg) => scope.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage(msg))),
        makeFirstFrame: (bytes, mime) =>
          typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined"
            ? Promise.resolve(null)
            : makeFirstFramePlaceholder(bytes, mime, o, {
                decode: (b) => createImageBitmap(b),
                createCanvas: (w, h) => new OffscreenCanvas(w, h),
              }),
        waitUntil: (p) => e.waitUntil(p),
        options: o,
      }),
    );
  });
}
