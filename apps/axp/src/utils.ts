import { AxiosHeaders, mergeConfig, type AxiosRequestConfig, type CreateAxiosDefaults, type RawAxiosHeaders } from "axios";
import { normalizeMethod } from "./methods";

/** AbortSignal 的标准事件名。 */
export const ABORT_EVENT = "abort";
/** setTimeout 可接受的最大毫秒数，超出会被运行时当作溢出立即触发。 */
const MAX_TIMEOUT = 2_147_483_647;
/** URL 起始的协议与主机部分，相对地址不命中；不带 g 标记，可安全复用。 */
export const ORIGIN_PREFIX = /^(?:[a-z][a-z\d+.-]*:)?\/\/[^/?#]*/i;
/** axios 在发送前展开的默认头分组，不作为真实 HTTP header。 */
export const HEADER_GROUPS = new Set(["common", "delete", "get", "head", "post", "put", "patch", "query"]);

/** 读取对象的标准类型标签。
 * @internal
 * @param value 任意值。
 * @returns 形如 `[object Date]` 的标签。
 * @example `toTag(new Date()) // "[object Date]"`
 */
export function toTag(value: unknown): string {
  return Object.prototype.toString.call(value);
}

/** 读取字段自身归属，保留无原型字典语义。
 * @internal
 * @param target 目标对象。
 * @param key 字段名。
 * @returns 是否自有字段。
 * @example `hasOwn({ a: 1 }, 'a') // true`
 */
export function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** 判断标量自身是否为空：null、undefined、NaN 或空白字符串；不看容器内容。
 * @internal
 * @param value 任意值。
 * @returns 是否应视为空值。
 * @example `isEmptyScalar('  ') // true`
 */
export function isEmptyScalar(value: unknown): boolean {
  return value == null || Number.isNaN(value) || (typeof value === "string" && value.trim() === "");
}

/** 判断非空对象，数组和特殊对象均保留为对象。
 * @internal
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** 判断可按字段复制的普通对象，包括无原型字典。
 * @internal
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 把任意值转成字符串，等价于 String(value)；入参声明为 unknown，如实表达调用点接受任意值。
 * @internal
 * @param value 待转换的值。
 * @returns 字符串，对象沿用自身的 toString 结果。
 * @example `toText(res.headers?.["content-type"] ?? "")`
 */
export function toText(value: unknown): string {
  return String(value);
}

/** 克隆默认头和方法分组，保留 false/null 等禁止发送标记。
 * @internal
 * @param headers 待复制的默认头容器。
 * @returns 独立容器，空值保持原样。
 * @example `cloneAxiosHeaders(defaults.headers)`
 */
export function cloneAxiosHeaders(headers: AxiosRequestConfig["headers"]): AxiosRequestConfig["headers"] {
  if (headers == null) return headers;
  if (headers instanceof AxiosHeaders) return new AxiosHeaders(headers);
  const cloned = mergeConfig({}, { headers }).headers!;
  for (const key of Object.keys(cloned)) {
    const value = cloned[key];
    if (value instanceof AxiosHeaders) cloned[key] = new AxiosHeaders(value);
  }
  return cloned;
}

/** 按 axios 公开合并规则复制可变配置，转换器函数保持身份。
 * @internal
 * @param defaults 待复制的 defaults 或显式覆盖配置。
 * @returns params、headers、转换器数组及普通嵌套容器独立的配置。
 * @example `createAxios(cloneAxiosDefaults(parent.defaults))`
 */
export function cloneAxiosDefaults(defaults: AxiosRequestConfig): AxiosRequestConfig {
  const cloned = mergeConfig({}, defaults);
  for (const key of Object.keys(defaults)) {
    if (key === "headers") cloned.headers = cloneAxiosHeaders(defaults.headers);
    else if (key === "params") cloned.params = cloneParams(defaults.params);
    else if (key === "transformRequest") cloned.transformRequest = toArray(defaults.transformRequest);
    else if (key === "transformResponse") cloned.transformResponse = toArray(defaults.transformResponse);
    else if (!(key in cloned)) Object.assign(cloned, { [key]: Reflect.get(defaults, key) });
  }
  return cloned;
}

/** 复制后按显式字段写回默认配置，避免覆盖未提供的字段。
 * @internal
 * @param target 接收配置的 axios defaults。
 * @param config 需要覆盖的字段。
 * @example `assignAxiosDefaults(client.axios.defaults, overrides)`
 */
export function assignAxiosDefaults(target: object, config: AxiosRequestConfig | CreateAxiosDefaults): void {
  Object.assign(target, cloneAxiosDefaults(config as AxiosRequestConfig));
}

/** 隔离通知回调的同步异常和异步拒绝，始终报告故障。
 * @internal
 * @param fn 通知回调。
 * @param label 控制台故障说明。
 * @param args 回调参数。
 * @example `fireNotice(loading, '[axp:loading] loading 回调失败', true)`
 */
export function fireNotice<A extends unknown[]>(fn: (...args: A) => unknown, label: string, ...args: A): void {
  try {
    void Promise.resolve(fn(...args)).catch(/** 异步通知故障不影响请求落定。 */ (error: unknown) => console.error(label, error));
  } catch (error) {
    console.error(label, error);
  }
}

/** 等待 promise，但 signal 中止或超时就提前返回；无论哪种结局都会解绑监听并清掉计时器。
 * 调用时 signal 已中止则立即返回，不挂监听也不起计时器。
 * @internal
 * @param pending 被等待的 promise；省略时只等超时或中止。拒绝原样传出。
 * @param signal 取消信号。
 * @param timeout 超时毫秒数，超过 setTimeout 上限按上限计；省略不计时。
 * @returns pending 的结果；中止或超时返回 undefined，调用方用 signal.aborted 区分两者。
 * @example `await waitAbortable(refreshing, ctx.signal)`
 */
export function waitAbortable<T>(pending?: Promise<T>, signal?: AbortSignal, timeout?: number): Promise<T | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    /** 只落定一次：先解绑监听、清计时器（增删必须成对），再交出结果；之后任一触发源再到达都只是空转。 */
    const settle = (outcome: (value: any) => void, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener(ABORT_EVENT, early);
      outcome(value);
    };
    /** 中止或超时：提前返回 undefined。 */
    const early = () => settle(resolve);
    if (timeout !== undefined) timer = setTimeout(early, Math.min(timeout, MAX_TIMEOUT));
    signal?.addEventListener(ABORT_EVENT, early, { once: true });
    void pending?.then(
      /** 等到结果。 */ (value) => settle(resolve, value),
      /** 等待对象拒绝：原样传出。 */ (error: unknown) => settle(reject, error),
    );
  });
}

/** 复制普通查询容器及数组元素，避免原生数组浅拷贝仍共享嵌套对象。 */
function cloneParams(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneParams);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(/** 每个查询字段独立复制可变容器。 */ ([key, item]) => [key, cloneParams(item)]));
  }
  return value;
}

/** 将转换器复制为独立数组，不重复添加函数。 */
function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  return value ? (Array.isArray(value) ? [...value] : [value]) : undefined;
}

/** 用公开 AxiosHeaders API 展开通用、方法和请求头，供管线直接读写有效头。
 * @internal
 * @param config 合并 defaults 后的请求或 defaults，默认头按其 method 选择。
 * @returns 新的平面头容器，不修改输入分组。
 * @example `effectiveHeaders(mergeConfig(axios.defaults, request))`
 */
export function effectiveHeaders(config: AxiosRequestConfig): AxiosHeaders {
  if (config.headers instanceof AxiosHeaders) return new AxiosHeaders(config.headers);
  const source = config.headers;
  const headers = new AxiosHeaders(source?.common as RawAxiosHeaders | undefined);
  const selected = source?.[normalizeMethod(config.method)] as RawAxiosHeaders | undefined;
  if (selected) headers.set(selected);
  for (const name of Object.keys(source ?? {})) {
    if (!HEADER_GROUPS.has(name)) headers.set(name, source![name]);
  }
  return headers;
}
