/**
 * Register the prebuilt standalone Service Worker (SW-hosted assembly mode).
 *
 * 注册预构建托管成品 Service Worker(SW 托管装配模式)。
 */

/**
 * Register `swUrl` as a module Service Worker and wait for it to become ready.
 * Never throws; degrades to `{ controlled: false }` when Service Workers are
 * unsupported or registration fails. Does not force a reload.
 *
 * 把 `swUrl` 注册为 module 类型 Service Worker 并等待就绪。绝不抛异常;不支持 SW
 * 或注册失败时降级为 `{ controlled: false }`。不会强制刷新页面。
 * @param swUrl - URL of the prebuilt SW script (e.g. '/picman-sw.js') — 预构建 SW 脚本 URL(如 '/picman-sw.js')
 * @returns Whether the current page is already controlled by the SW — 当前页面是否已被该 SW 控制
 * @example
 * const { controlled } = await registerPicmanSW('/picman-sw.js')
 * if (!controlled) location.reload() // first visit — 首次访问,需要用户自行决定是否刷新
 */
export async function registerPicmanSW(swUrl: string): Promise<{ controlled: boolean }> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return { controlled: false };
  try {
    await navigator.serviceWorker.register(swUrl, { type: "module" });
    await navigator.serviceWorker.ready;
    return { controlled: !!navigator.serviceWorker.controller };
  } catch {
    return { controlled: false };
  }
}
