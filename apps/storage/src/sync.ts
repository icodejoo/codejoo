import type { StorageOptions, SyncStore } from "./interface";
import type { Handlers } from "./proxy";
import { supported } from "./helper";

/** 插件内部的宽松方法签名（处理器方法均为闭包实现、不依赖 this，可安全取引用与替换） */
interface Wrapped {
  set(key: string, value: unknown, options?: number | StorageOptions): unknown;
  remove(key: string | readonly string[]): unknown;
  clear(): unknown;
  /** 幂等标记：已挂载过则再次调用为空操作 */
  __crossTab?: boolean;
}

/**
 * 跨标签页同步插件（**独立导入**、可 tree-shake，不进核心）。
 * 仅在原生 storage 不可用、退回纯内存模式时启用：此时各标签页的数据彼此隔离，
 * 本插件用 BroadcastChannel 将 set/remove/clear 广播到同源其他标签页回放，保持各标签内存数据一致。
 * 原生 storage 可用时数据本就跨标签共享，插件直接空操作；重复挂载同一 handler 也为空操作。
 *
 * 注意：
 * - 本地写入**先于**广播生效；广播经结构化克隆，值不可克隆时仅告警、不影响本地数据；
 * - `setNamespace` 不参与同步——切换命名空间（如切账号）需各标签页自行调用；
 * - 回放在远端各自构建 entity，createdAt/expireAt 与源标签可能相差毫秒级。
 *
 * ```ts
 * import { factory, crossTab } from "@codejoo/storage";
 * const { ls } = factory();
 * const stop = crossTab(ls); // 仅纯内存模式下生效
 * ```
 * @returns 停止函数：关闭通道并还原被包装的方法
 */
/** 同进程内 channel 名 → 已挂载的 handler，用于识别「不同 handler 共用同一 channel」的误用（见下方 owners 检查） */
const owners = new Map<string, Wrapped>();

export function crossTab(handler: Handlers<SyncStore>, channel = "@codejoo/storage:sync"): () => void {
  const h = handler as unknown as Wrapped;
  if (supported.storage || typeof BroadcastChannel === "undefined" || h.__crossTab) return () => {};
  // 同一 channel 已被另一 handler（如 ls 和 ss）占用：两者会互相回放对方的写入——此处仅告警，不阻止（BroadcastChannel 允许多方监听）
  const owner = owners.get(channel);
  if (owner && owner !== h) console.warn(`[storage] crossTab: channel "${channel}" is already used by another handler; their writes will cross-replay onto each other. Pass a distinct channel per handler.`);
  owners.set(channel, h);
  h.__crossTab = true;
  const bc = new BroadcastChannel(channel);
  // 原始引用：回放远端操作时直接调用，不再二次广播。处理器方法均为闭包实现、不依赖 this，取引用安全
  // oxlint-disable-next-line typescript-eslint/unbound-method
  const { set, remove, clear } = h;
  /** 广播失败（值不可结构化克隆等）只告警——本地写入已先行生效，不能被广播问题破坏 */
  const cast = (msg: unknown[]): void => {
    try {
      bc.postMessage(msg);
    } catch (err) {
      console.warn("[storage] crossTab broadcast failed (value not structured-cloneable?); local write is unaffected", err);
    }
  };

  h.set = (k, v, o) => {
    const r = set(k, v, o);
    cast(["set", k, v, o]);
    return r;
  };
  h.remove = (k) => {
    const r = remove(k);
    cast(["remove", k]);
    return r;
  };
  h.clear = () => {
    const r = clear();
    cast(["clear"]);
    return r;
  };
  bc.onmessage = (e: MessageEvent) => {
    const [op, k, v, o] = e.data as [string, string, unknown, undefined];
    if (op === "set") set(k, v, o);
    else if (op === "remove") remove(k);
    else clear();
  };

  return () => {
    bc.close();
    h.__crossTab = false;
    if (owners.get(channel) === h) owners.delete(channel); // 释放占用，避免误判后续接手同 channel 的新 handler
    Object.assign(h, { set, remove, clear });
  };
}
