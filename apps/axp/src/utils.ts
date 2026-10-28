import {
  AxiosHeaders,
  mergeConfig,
  type AxiosRequestConfig,
  type CreateAxiosDefaults,
  type RawAxiosHeaders,
} from "axios";
import { normalizeMethod } from "./methods";

/** axios 在发送前展开的默认头分组，不作为真实 HTTP header。 */
export const HEADER_GROUPS = new Set([
  "common",
  "delete",
  "get",
  "head",
  "post",
  "put",
  "patch",
  "query",
]);

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

/** 克隆默认头和方法分组，保留 false/null 等禁止发送标记。
 * @internal
 * @param headers 待复制的默认头容器。
 * @returns 独立容器，空值保持原样。
 * @example `cloneAxiosHeaders(defaults.headers)`
 */
export function cloneAxiosHeaders(
  headers: AxiosRequestConfig["headers"],
): AxiosRequestConfig["headers"] {
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
    else if (key === "transformRequest")
      cloned.transformRequest = toArray(defaults.transformRequest);
    else if (key === "transformResponse")
      cloned.transformResponse = toArray(defaults.transformResponse);
    else if (!(key in cloned))
      Object.assign(cloned, { [key]: defaults[key as keyof AxiosRequestConfig] });
  }
  return cloned;
}

/** 复制后按显式字段写回默认配置，避免覆盖未提供的字段。
 * @internal
 * @param target 接收配置的 axios defaults。
 * @param config 需要覆盖的字段。
 * @example `assignAxiosDefaults(client.axios.defaults, overrides)`
 */
export function assignAxiosDefaults(
  target: object,
  config: AxiosRequestConfig | CreateAxiosDefaults,
): void {
  Object.assign(target, cloneAxiosDefaults(config as AxiosRequestConfig));
}

/** 隔离通知回调的同步异常和异步拒绝，始终报告故障。
 * @internal
 * @param fn 通知回调。
 * @param label 控制台故障说明。
 * @param args 回调参数。
 * @example `fireNotice(loading, '[axp:loading] loading 回调失败', true)`
 */
export function fireNotice<A extends unknown[]>(
  fn: (...args: A) => unknown,
  label: string,
  ...args: A
): void {
  try {
    void Promise.resolve(fn(...args)).catch(
      /** 异步通知故障不影响请求落定。 */ (error: unknown) => console.error(label, error),
    );
  } catch (error) {
    console.error(label, error);
  }
}

/** 复制普通查询容器及数组元素，避免原生数组浅拷贝仍共享嵌套对象。 */
function cloneParams(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneParams);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(
        /** 每个查询字段独立复制可变容器。 */ ([key, item]) => [key, cloneParams(item)],
      ),
    );
  }
  return value;
}

/** 将转换器复制为独立数组，不重复添加函数。 */
function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  return value ? (Array.isArray(value) ? [...value] : [value]) : undefined;
}

/** 用公开 AxiosHeaders API 展开通用、方法和请求头，供管线直接读写有效头。
 * @internal
 * @param config 合并 defaults 后的请求或 defaults。
 * @param method 默认头应采用的请求方法。
 * @returns 新的平面头容器，不修改输入分组。
 * @example `effectiveHeaders(mergeConfig(axios.defaults, request))`
 */
export function effectiveHeaders(config: AxiosRequestConfig, method = config.method): AxiosHeaders {
  if (config.headers instanceof AxiosHeaders) return new AxiosHeaders(config.headers);
  const source = config.headers;
  const headers = new AxiosHeaders(source?.common as RawAxiosHeaders | undefined);
  const selected = source?.[normalizeMethod(method)] as RawAxiosHeaders | undefined;
  if (selected) headers.set(selected);
  for (const name of Object.keys(source ?? {})) {
    if (!HEADER_GROUPS.has(name)) headers.set(name, source![name]);
  }
  return headers;
}
