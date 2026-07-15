/**
 * Page-side message bus: a single SW message listener fanned out per URL,
 * shared by load() and auto().
 *
 * 页面端消息总线:单一 SW 消息监听器按 URL 分发,load()/auto() 共用。
 */

import { isPicmanMessage } from "../shared/protocol";

/**
 * Normalized stage event delivered to page-side subscribers.
 *
 * 交付给页面端订阅者的规范化阶段事件。
 */
export type StageEvent = { type: "first-frame" | "complete" | "error"; url: string; message?: string };

/** Per-URL subscriber sets — 按 URL 分组的订阅者集合 */
const registry = new Map<string, Set<(e: StageEvent) => void>>();

/** Currently active ServiceWorkerContainer, injectable for tests — 当前生效的 ServiceWorkerContainer,测试可注入 */
let container: ServiceWorkerContainer | null = typeof navigator !== "undefined" ? (navigator.serviceWorker ?? null) : null;
/** Whether {@link onMessage} is attached to {@link container} — {@link onMessage} 是否已挂到 {@link container} */
let listening = false;

/**
 * Dispatch an incoming SW message to that URL's subscribers.
 *
 * 把收到的 SW 消息分发给该 URL 的订阅者。
 * @param e - Raw message event — 原始消息事件
 */
function onMessage(e: MessageEvent): void {
  if (!isPicmanMessage(e.data)) return;
  const subs = registry.get(e.data.url);
  if (!subs) return;
  const evt: StageEvent = e.data.type === "error" ? { type: "error", url: e.data.url, message: e.data.message } : { type: e.data.type, url: e.data.url };
  for (const cb of subs) cb(evt);
}

/**
 * Ensure the shared message listener is attached to the current container.
 *
 * 确保共享消息监听器已挂到当前容器。
 */
function ensureListening(): void {
  if (listening || !container) return;
  container.addEventListener("message", onMessage);
  listening = true;
}

/**
 * Replace the active ServiceWorkerContainer (test injection point); pass
 * null to simulate an environment without Service Worker support.
 *
 * 替换生效的 ServiceWorkerContainer(测试注入点);传 null 模拟不支持 SW 的环境。
 * @param sw - Container to use, or null — 待使用的容器,或 null
 */
export function _setServiceWorkerContainer(sw: ServiceWorkerContainer | null): void {
  if (listening && container) container.removeEventListener("message", onMessage);
  container = sw;
  listening = false;
}

/**
 * Current ServiceWorkerContainer, if any (internal — used by load()/auto() to
 * detect SW support consistently with the injected test container).
 *
 * 当前 ServiceWorkerContainer(内部使用——供 load()/auto() 与测试注入容器保持一致地判定 SW 支持)。
 * @returns Active container or null — 生效的容器,或 null
 */
export function _getContainer(): ServiceWorkerContainer | null {
  return container;
}

/**
 * Subscribe to stage events for one canonical image URL.
 *
 * 订阅某个规范化图片 URL 的阶段事件。
 * @param url - Canonical image URL — 规范化图片 URL
 * @param cb - Stage event callback — 阶段事件回调
 * @returns Unsubscribe function — 退订函数
 * @example
 * const unsubscribe = subscribe(url, e => console.log(e.type))
 */
export function subscribe(url: string, cb: (e: StageEvent) => void): () => void {
  let subs = registry.get(url);
  if (!subs) {
    subs = new Set();
    registry.set(url, subs);
  }
  subs.add(cb);
  ensureListening();

  return () => {
    subs!.delete(cb);
    if (subs!.size === 0) registry.delete(url);
  };
}
