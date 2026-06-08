import type { AsyncStorage, SyncStore } from "./interface";
import type { Handlers, Result } from "./proxy";

/** 调试快照在缓存中暂存所用的键 */
const DEBUG_KEY = "_$debug";
const isPromise = (v: unknown): v is Promise<unknown> =>
  typeof (v as { then?: unknown } | null)?.then === "function";

/**
 * 调试快照（**独立导入**，不进核心 proxy，便于 tree-shake、缩小核心体积）。
 * 读出 handler 所有条目的「解密后」明文值，组装为 `{ 完整逻辑键(含命名空间): 值 }` 大对象，
 * 用 `"_$debug"` 作为键存回缓存，并返回该对象。用于 enckey/codeable 加密场景下查看真实内容。
 *
 * ```ts
 * import { debug } from "@codejoo/storage";
 * const { ls, db } = factory({ codeable: true, codec, enckey: true });
 * debug(ls);          // 同步：{ "ns:token": "...", ... }
 * await debug(db);    // 异步后端返回 Promise
 * ```
 */
export function debug<S extends SyncStore | AsyncStorage>(
  handler: Handlers<S>,
): Result<S, Record<string, unknown>> {
  const ns = handler.namespace;
  const getKey = handler.key as (i: number) => string | null | Promise<string | null>;
  const getVal = handler.get as (k: string) => unknown;
  const setVal = handler.set as (k: string, v: unknown) => unknown;
  const len = handler.length;

  // 同步后端
  if (!isPromise(len)) {
    const dump: Record<string, unknown> = {};
    for (let i = 0; i < (len as number); i++) {
      const k = getKey(i) as string | null;
      if (k == null || k === DEBUG_KEY) continue;
      dump[ns + k] = getVal(k); // 保留命名空间前缀
    }
    setVal(DEBUG_KEY, dump);
    return dump as Result<S, Record<string, unknown>>;
  }

  // 异步后端
  return (async () => {
    const dump: Record<string, unknown> = {};
    const n = await (len as Promise<number>);
    for (let i = 0; i < n; i++) {
      const k = await (getKey(i) as Promise<string | null>);
      if (k == null || k === DEBUG_KEY) continue;
      dump[ns + k] = await (getVal(k) as Promise<unknown>);
    }
    await (setVal(DEBUG_KEY, dump) as Promise<unknown>);
    return dump;
  })() as Result<S, Record<string, unknown>>;
}
