import type { AsyncStorage, SyncStore } from "./interface";
import { type Handlers, type Result, isPromise } from "./proxy";

/** 调试快照在缓存中暂存所用的键 */
const DEBUG_KEY = "_$debug";

/**
 * 调试快照（**独立导入**，不进核心 proxy，便于 tree-shake、缩小核心体积）。
 * 基于 handler.keys()（仅本实例管辖的键，命名空间下不混入外部数据）读出全部条目的「解密后」明文值，
 * 组装为 `{ 完整逻辑键(含命名空间): 值 }` 大对象，用 `"_$debug"` 作为键存回缓存并返回。
 * 用于 enckey/codeable 加密场景下查看真实内容。
 *
 * ```ts
 * import { debug } from "@codejoo/storage";
 * const { ls, db } = factory({ codeable: true, codec, enckey: true });
 * debug(ls);          // 同步：{ "ns:token": "...", ... }
 * await debug(db);    // 异步后端返回 Promise
 * ```
 */
export function debug<S extends SyncStore | AsyncStorage>(handler: Handlers<S>): Result<S, Record<string, unknown>> {
  const ns = handler.namespace;
  const h = handler as Handlers<SyncStore>; // 内部按宽松（同步形）签名转发，真实同步/异步由运行时判断
  const ks = h.keys() as string[] | Promise<string[]>;
  const dump: Record<string, unknown> = {};

  if (!isPromise(ks)) {
    for (const k of ks) if (k !== DEBUG_KEY) dump[ns + k] = h.get(k); // 保留命名空间前缀
    h.set(DEBUG_KEY, dump);
    return dump as Result<S, Record<string, unknown>>;
  }

  return (async () => {
    for (const k of await ks) {
      if (k !== DEBUG_KEY) dump[ns + k] = await (h.get(k) as unknown as Promise<unknown>);
    }
    await (h.set(DEBUG_KEY, dump) as unknown as Promise<void>);
    return dump;
  })() as Result<S, Record<string, unknown>>;
}
