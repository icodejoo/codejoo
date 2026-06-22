/**
 * 请求级私有附加数据 —— 以单个 `Symbol` 挂在 axios config 上。
 *
 *   - 对 `for...in` / `Object.keys` / `JSON.stringify` / 解构 / axios 自身的 config
 *     序列化**全不可见**，因此可安全存放内部脚手架（如 cancel 的 AbortController），
 *     不污染下游、不外泄给调用方。
 *   - **生命周期仅限单次请求**：Symbol 键无法熬过 axios `mergeConfig` 的 re-merge
 *     （实测 re-merge 只保留可枚举字符串键，Symbol / 非枚举键一律丢弃），所以 bag
 *     **不跨 retry 的 `ctx.axios.request(config)` 重发**。需要跨重发存活的状态请另用
 *     WeakMap<config> 或可枚举字段。
 *
 * 这是 B2 方案 A 的私有化载体：把原先以可枚举字符串键（如 `_cancelCtrl`）挂在 config
 * 上的内部引用收进这里，既满足"标记为私有、外部不可访问"，又避免这些对象引用经由
 * 可枚举字段意外延长生命周期。
 */
const BAG = Symbol('axp.internal');

type Bag = Record<string, unknown>;

function bagOf(config: object, create: boolean): Bag | undefined {
  let bag = (config as Record<symbol, unknown>)[BAG] as Bag | undefined;
  if (!bag && create) {
    bag = {};
    Object.defineProperty(config, BAG, {
      value: bag,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return bag;
}

/** 写入一条私有数据（按需创建 bag）。 */
export function setInternal(config: object, key: string, value: unknown): void {
  bagOf(config, true)![key] = value;
}

/** 读取一条私有数据；不存在返回 `undefined`。 */
export function getInternal<T = unknown>(config: object, key: string): T | undefined {
  return bagOf(config, false)?.[key] as T | undefined;
}

/** 删除一条私有数据（释放其引用，利于 GC）。 */
export function delInternal(config: object, key: string): void {
  const bag = bagOf(config, false);
  if (bag) delete bag[key];
}
