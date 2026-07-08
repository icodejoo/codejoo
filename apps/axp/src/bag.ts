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
 *
 * Request-scoped private side-channel data, attached to the axios config via a
 * single `Symbol`.
 *
 *   - Invisible to `for...in`/`Object.keys`/`JSON.stringify`/destructuring/axios's
 *     own config serialization — safe for internal scaffolding (e.g. cancel's
 *     AbortController) without leaking downstream or to callers.
 *   - Lifetime is scoped to a single request: a Symbol key can't survive axios's
 *     `mergeConfig` re-merge (verified — re-merge keeps only enumerable string
 *     keys), so the bag does NOT survive a retry's re-dispatch via
 *     `ctx.axios.request(config)`. State needing to survive a re-dispatch should
 *     use a `WeakMap<config>` or an enumerable field instead.
 *
 * This is the private carrier for plan B2/A — moving internal refs that used to
 * live on enumerable string keys (e.g. `_cancelCtrl`) in here, keeping them
 * private without accidentally extending their lifetime via an enumerable field.
 */
const BAG = Symbol('axp.internal');

/** 单次请求的私有数据袋 / a single request's private data bag. */
type Bag = Record<string, unknown>;

/** 读取（或按需创建）挂在 config 上的私有数据袋 / reads (or lazily creates) the private bag attached to config. */
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

/**
 * 写入一条私有数据（按需创建 bag）。
 *
 * Writes one entry of private data (lazily creates the bag if needed).
 *
 * @param config 目标 axios config（或任意对象） / the target axios config (or any object)
 * @param key 数据键 / the data key
 * @param value 要写入的值 / the value to write
 */
export function setInternal(config: object, key: string, value: unknown): void {
  bagOf(config, true)![key] = value;
}

/**
 * 读取一条私有数据；不存在返回 undefined。
 *
 * Reads one entry of private data; returns undefined if absent.
 *
 * @param config 目标 axios config（或任意对象） / the target axios config (or any object)
 * @param key 数据键 / the data key
 */
export function getInternal<T = unknown>(config: object, key: string): T | undefined {
  return bagOf(config, false)?.[key] as T | undefined;
}

/**
 * 删除一条私有数据（释放其引用，利于 GC）。
 *
 * Deletes one entry of private data (releases its reference, aiding GC).
 *
 * @param config 目标 axios config（或任意对象） / the target axios config (or any object)
 * @param key 数据键 / the data key
 */
export function delInternal(config: object, key: string): void {
  const bag = bagOf(config, false);
  if (bag) delete bag[key];
}
