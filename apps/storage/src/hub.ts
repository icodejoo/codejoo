/** memo 失效通知；null 表示清空全部，空字符串是合法键。 */
type Invalidate = (key: string | null) => void;
/** 以真实后端身份共享同标签失效通知。 */
const hubs = /*#__PURE__*/ new WeakMap<object, Set<Invalidate>>();
/** 活跃订阅数，用于释放全局监听器。 */
let count = 0;
/** 广播给同后端的其他实例。 */
export function invalidate(area: object, key: string | null, source?: Invalidate): void {
  hubs.get(area)?.forEach(fn => { if (fn !== source) fn(key); });
}
/** 区分 localStorage/sessionStorage 的跨标签事件。 */
function storageEvent(event: StorageEvent): void {
  if (event.storageArea) invalidate(event.storageArea, event.key);
}
/** 惰性订阅；最后一个订阅销毁时移除监听器。 */
export function register(area: object, fn: Invalidate): () => void {
  let listeners = hubs.get(area);
  if (!listeners) hubs.set(area, listeners = new Set());
  listeners.add(fn);
  if (++count === 1 && typeof window !== "undefined") window.addEventListener("storage", storageEvent);
  return () => {
    if (!listeners.delete(fn)) return;
    if (--count === 0 && typeof window !== "undefined") window.removeEventListener("storage", storageEvent);
  };
}
/** IndexedDB 跨标签 memo 失效通道前缀。 */
const CHANNEL = "@codejoo/storage:memo:";
/** 管理一个实例的惰性注册与可选广播连接，不缓存业务数据。 */
export function memoHub(area: object, receive: Invalidate, name?: string) {
  let unsubscribe: (() => void) | undefined, channel: BroadcastChannel | undefined;
  /** 显式开启跨标签通知时才构造通道。 */
  const open = () => {
    if (name === undefined || typeof BroadcastChannel === "undefined") return;
    const target = new BroadcastChannel(CHANNEL + name);
    target.onmessage = event => { if (event.data === null || typeof event.data === "string") receive(event.data); };
    return target;
  };
  return {
    /** 实际开始缓存时注册，避免未使用的占位后端占用监听器。 */
    connect() {
      unsubscribe ??= register(area, receive);
      channel ??= open();
    },
    /** 落盘成功后使同标签和可选的跨标签缓存失效。 */
    publish(key: string | null) {
      invalidate(area, key, receive);
      channel ??= open(); channel?.postMessage(key);
    },
    /** 注销订阅，释放通道；允许后续重新使用时再次连接。 */
    destroy() { unsubscribe?.(); unsubscribe = undefined; channel?.close(); channel = undefined; },
  };
}
