import type { AsyncStorage, StorageOptions, SyncStore } from "./interface";
import type { Handlers } from "./proxy";

/** 绑定 key 的快捷访问器（同步后端） */
export interface SyncAccessor<V> {
  get(): V | null;
  get(defaultValue: V): V;
  set(value: V, options?: number | boolean | StorageOptions): void;
  remove(): void;
}

/** 绑定 key 的快捷访问器（异步后端） */
export interface AsyncAccessor<V> {
  get(): Promise<V | null>;
  get(defaultValue: V): Promise<V>;
  set(value: V, options?: number | boolean | StorageOptions): Promise<void>;
  remove(): Promise<void>;
}

/**
 * @description 快速增删查，免去不停写 key 的痛苦，缩短调用路径。
 * 绑定一个 proxy 处理器（factory 的 ls/ss/db）与某个 key，get/set/remove 转发到底层。
 * 值类型在 `fast<T>(...)` 指定一次即可，后续 get/set 无需重复声明；
 * 同步/异步返回由 target 经重载自动区分（ls/ss 同步，db 返回 Promise）。
 * @param target proxy 处理器
 * @param key 绑定的键名
 */
export function fast<V = unknown>(target: Handlers<SyncStore>, key: string): SyncAccessor<V>;
export function fast<V = unknown>(target: Handlers<AsyncStorage>, key: string): AsyncAccessor<V>;
export function fast(target: Handlers<SyncStore | AsyncStorage>, key: string) {
  function get(defaultValue?: unknown): unknown {
    return defaultValue === undefined
      ? (target.get as (k: string) => unknown)(key)
      : (target.get as (k: string, d: unknown) => unknown)(key, defaultValue);
  }
  function set(value: unknown, options?: number | boolean | StorageOptions): unknown {
    return (
      target.set as (k: string, v: unknown, o?: number | boolean | StorageOptions) => unknown
    )(key, value, options);
  }
  return { get, set, remove: () => target.remove(key) };
}

/**
 * 懒工厂：返回一个 getter，**首次调用才创建** fast 访问器并缓存复用（之后零分配）。
 * 配合 `/*#__PURE__*​/` 注释，未被使用的导出可被打包器 tree-shake 掉：
 * ```ts
 * export const a = /*#__PURE__*​/ lazy<string>(ls, "a");
 * a().get();           // 首次访问才建包装
 * ```
 * 对比直接 `export const a = fast(ls, "a")`：lazy 把 fast 的创建从「import 时」推迟到「首次用时」，
 * 用不到的 key 既不分配、也(配合 PURE)不进 bundle。
 */
export function lazy<V = unknown>(target: Handlers<SyncStore>, key: string): () => SyncAccessor<V>;
export function lazy<V = unknown>(target: Handlers<AsyncStorage>, key: string): () => AsyncAccessor<V>;
export function lazy(target: Handlers<SyncStore | AsyncStorage>, key: string): () => unknown {
  let acc: unknown;
  return () =>
    (acc ??= (fast as (t: Handlers<SyncStore>, k: string) => unknown)(
      target as Handlers<SyncStore>,
      key,
    ));
}

/**
 * 批量绑定：返回一个以 keys 为属性名的对象，每个属性是对应 key 的快捷访问器。
 * ```ts
 * const { token, user } = batchFast(ls, ["token", "user"]);
 * token.set("abc"); user.get();
 * ```
 * 值类型 V 对所有 key 统一；省略时为 unknown。键名通过 const 泛型保留为字面量。
 */
export function batchFast<V = unknown, const K extends readonly string[] = readonly string[]>(
  target: Handlers<SyncStore>,
  keys: K,
): { [P in K[number]]: SyncAccessor<V> };
export function batchFast<V = unknown, const K extends readonly string[] = readonly string[]>(
  target: Handlers<AsyncStorage>,
  keys: K,
): { [P in K[number]]: AsyncAccessor<V> };
export function batchFast(target: Handlers<SyncStore | AsyncStorage>, keys: readonly string[]) {
  const acc: Record<string, unknown> = {};
  for (const k of keys) acc[k] = (fast as (t: Handlers<SyncStore>, key: string) => unknown)(target as Handlers<SyncStore>, k);
  return acc;
}
