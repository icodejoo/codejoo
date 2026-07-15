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
  const scope = self as unknown as ServiceWorkerGlobalScope;

  scope.addEventListener("install", () => scope.skipWaiting());
  scope.addEventListener("activate", (e) => e.waitUntil(scope.clients.claim()));

  scope.addEventListener("fetch", (e) => {
    if (!shouldIntercept(e.request, o)) return;
    e.respondWith(
      handleImageRequest(e.request, {
        fetchImpl: fetch.bind(scope),
        cache,
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
