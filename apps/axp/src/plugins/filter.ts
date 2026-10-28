import { resolveOption, type AxpOption, type IPluginSwitch } from "../options";
import type { IAxpResponse } from "../response";
import type { AxpPlugin } from "../types";
import { isPlainObject } from "../utils";

/** 内置空字段过滤插件名称。 */
const NAME = "axp:filter";
/** 返回严格的 true 时丢弃顶层字段。 */
export type TPredicate = (entry: [key: string, value: any]) => boolean;
/** 被剥离的键值对，可用于诊断。 */
export type TDroppedKV = [key: string, value: any];
/** 顶层空字段过滤选项。 */
export interface IFilterOptions extends IPluginSwitch {
  /** 判断是否丢弃，默认剥离空值和空白字符串。 */
  predicate?: TPredicate;
  /** 命中键名的字段直接保留。 */
  ignoreKeys?: string[];
  /** 命中值的字段直接保留，支持 NaN。 */
  ignoreValues?: any[];
}
/** 默认空字段规则，保留零、false、对象和数组。
 * @param entry 顶层键值对。
 * @returns 是否应丢弃。
 * @example `defaultPredicate(['name', '  ']) // true`
 */
export function defaultPredicate([, value]: TDroppedKV): boolean {
  return isEmptyValue(value);
}
/** 默认规则直接判断值，避免为谓词分配键值对。 */
function isEmptyValue(value: unknown): boolean {
  return value == null || Number.isNaN(value) || (typeof value === "string" && value.trim() === "");
}
/** 过滤器内置谓词。 */
const DEFAULTS = { /** 默认空字段规则。 */ predicate: defaultPredicate };
/** 将豁免列表一次性准备为集合。 */
function prepareOptions(options: IFilterOptions & typeof DEFAULTS) {
  return {
    /** 字段过滤规则。 */ predicate: options.predicate,
    /** 直接保留的字段名。 */ ignoreKeys: new Set(options.ignoreKeys),
    /** 直接保留的值，保留 NaN 的匹配语义。 */ ignoreValues: new Set(options.ignoreValues),
  };
}
/** 用已准备的集合过滤，每个字段至多分配一个共享元组。 */
function filterFields(
  source: Record<string, any>,
  options: ReturnType<typeof prepareOptions>,
  dropped?: TDroppedKV[],
): Record<string, any> {
  const entries: TDroppedKV[] = [];
  for (const key of Object.keys(source)) {
    const value = source[key];
    let entry: TDroppedKV | undefined;
    const drop =
      !options.ignoreKeys.has(key) &&
      !options.ignoreValues.has(value) &&
      (options.predicate === defaultPredicate
        ? isEmptyValue(value)
        : options.predicate((entry = [key, value])) === true);
    if (drop) {
      if (dropped) dropped.push(entry ?? [key, value]);
    } else entries.push(entry ?? [key, value]);
  }
  return Object.fromEntries(entries);
}
/** 过滤自有可枚举字段，不修改来源对象或嵌套数据。
 * @param source 字段字典。
 * @param options 过滤谓词和豁免列表。
 * @param dropped 可选的被剥离字段记录。
 * @returns 新的顶层字典。
 * @example `$filter({ id: 0, name: '' }, { predicate: defaultPredicate }) // { id: 0 }`
 */
export function $filter(
  source: Record<string, any>,
  options: IFilterOptions & typeof DEFAULTS,
  dropped?: TDroppedKV[],
): Record<string, any> {
  return filterFields(source, prepareOptions(options), dropped);
}
/** 装上即过滤纯对象的顶层字段，特殊请求体保持原引用。
 * @param options 过滤谓词、豁免集合和插件总开关。
 * @returns 在 repath 之后以 patch 传递新对象的 prepare 插件。
 * @example `axpFilter({ ignoreKeys: ['nullable'] })`
 */
export default function axpFilter<R extends IAxpResponse = IAxpResponse>(
  options: IFilterOptions = {},
): AxpPlugin<R> {
  const base = resolveOption<IFilterOptions, typeof DEFAULTS>(undefined, options, DEFAULTS);
  base.ignoreKeys = base.ignoreKeys?.slice();
  base.ignoreValues = base.ignoreValues?.slice();
  const prepared = prepareOptions(base);
  return {
    name: NAME,
    enable: options.enable,
    stage: "prepare",
    /** 判定异常交给内核保留原始错误。 */
    async handle(ctx, next) {
      const { params, data } = ctx.request;
      const filterParams = isPlainObject(params);
      const filterData = isPlainObject(data);
      if (!filterParams && !filterData) return next();
      const value = ctx.request.filter;
      if (value === false) return next();
      const resolved = isPlainObject(value) ? resolveOption(value, base, DEFAULTS) : base;
      if (!resolved) return next();
      const config = resolved === base ? prepared : prepareOptions(resolved);
      return next({
        params: filterParams ? filterFields(params, config) : params,
        data: filterData ? filterFields(data, config) : data,
      });
    },
  };
}

declare module "../types" {
  interface AxpRequestOptions {
    /** 布尔开关或字段覆盖，不再调用请求级函数。 */
    filter?: AxpOption<IFilterOptions>;
  }
}
