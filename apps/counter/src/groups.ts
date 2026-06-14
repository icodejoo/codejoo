import { start } from "./core";
import { lazyStart } from "./helper";

/** 分组的默认标签；该分组常驻（清空也不删除），其余分组空了即删 */
export const defaultLabel = "default";

/**
 * 统一「立即开始 / 进入视口才开始」的接线（count-up / count-down 共用）。
 * - active 或无 el：立即 start()，返回 undefined（无需 cancel）。
 * - lazy（active=false 且有 el）：观察 el，进入视口时执行 onActivate() 并 start()，返回取消函数。
 * - timeout>0 且提供 onTimeout：若超时仍未进入视口，则断开观察并执行 onTimeout（用于回收"永不可见"的懒任务）。
 */
export function scheduleStart(active: boolean, el: Element | undefined, observer: IntersectionObserver | undefined, onActivate: () => void, timeout = 0, onTimeout?: () => void): (() => void) | undefined {
  if (active || !el) {
    start();
    return undefined;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelObserve = lazyStart(
    el,
    () => {
      if (timer) clearTimeout(timer);
      onActivate();
      start();
    },
    observer,
  );
  if (timeout > 0 && onTimeout) {
    timer = setTimeout(() => {
      cancelObserve(); // 断开观察
      onTimeout(); // 回收任务
    }, timeout);
  }
  return () => {
    if (timer) clearTimeout(timer);
    cancelObserve();
  };
}

export interface IGroup<T, C> {
  config?: C;
  /** id → task 映射，保证按 id 删除为 O(1) */
  queue: Map<number, T>;
}

export interface IGroupStore<T, C> {
  groups: Map<string, IGroup<T, C>>;
  group(label?: string, options?: C): IGroup<T, C>;
  remove(id: number, label?: string): void;
  clear(label?: string): void;
}

/**
 * 通用「分组任务队列」管理 —— count-up / count-down 共用。
 * 仅封装两者完全一致的脚手架：groups(label → {config, queue}) 的增删、配置合并、空分组回收；
 * 各自不同的部分（tick 推进、add 逻辑、任务清理细节）通过 hooks 注入、留在各模块。
 *
 * @param hooks.onRemove   remove(id) 删除某任务时的清理（如断开 observer、记录末值）
 * @param hooks.onClearEach clear() 对每个任务的清理（缺省复用 onRemove；countdown 在此额外触发 onDestroy）
 */
export function createGroupStore<T, C>(hooks?: { onRemove?: (task: T) => void; onClearEach?: (task: T) => void }): IGroupStore<T, C> {
  const groups = new Map<string, IGroup<T, C>>();
  groups.set(defaultLabel, { queue: new Map() });

  function group(label = defaultLabel, options?: C): IGroup<T, C> {
    let g = groups.get(label);
    if (!g) {
      g = { config: options, queue: new Map() };
      groups.set(label, g);
    } else if (options) {
      g.config = g.config ? { ...g.config, ...options } : options;
    }
    return g;
  }

  function remove(id: number, label = defaultLabel) {
    const g = groups.get(label);
    if (!g) return;
    const t = g.queue.get(id);
    if (t) hooks?.onRemove?.(t);
    if (!g.queue.delete(id)) return;
    if (g.queue.size === 0 && label !== defaultLabel) groups.delete(label);
  }

  function clear(label = defaultLabel) {
    const g = groups.get(label);
    if (!g) return;
    const each = hooks?.onClearEach ?? hooks?.onRemove;
    if (each) g.queue.forEach(each);
    g.queue.clear();
    if (label !== defaultLabel) groups.delete(label);
  }

  return { groups, group, remove, clear };
}
