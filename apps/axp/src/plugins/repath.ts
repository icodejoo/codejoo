import { resolveRequestOption, resolveOption, type AxpOption, type IPluginSwitch } from "../options";
import type { AxpResponse, IAxpResponse } from "../response";
import type { AxpPlugin } from "../types";
import { isObject, ORIGIN_PREFIX, toTag, toText } from "../utils";

/** 内置路径替换插件名称。 */
const NAME = "axp:repath";
/** 三种路径变量，冒号变量仅匹配单个路径段。 */
const DEFAULT_PATTERN = /{([^}]+)}|\[([^\]]+)]|:([^/\s]+)/g;
/** 普通对象的类型标签，只有它的字段才可能提供路径变量。 */
const PLAIN_TAG = "[object Object]";
/** 路径变量的内置配置。 */
const DEFAULTS = {
  /** 三种路径变量语法。 */ pattern: DEFAULT_PATTERN,
  /** 删除已消费字段。 */ removeKey: true,
};
/** 路径变量配置。 */
export interface IRepathOptions extends IPluginSwitch {
  /** 捕获组提供变量名的正则表达式。 */
  pattern?: RegExp;
  /** 替换后移除来源字段，默认开启。 */
  removeKey?: boolean;
}
/** 复制外壳后删除已消费字段。 */
function omit(source: object | undefined, keys?: Set<string>): unknown {
  if (!keys) return source;
  const copy: Record<string, unknown> = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}
/** 只为实际读到的路径变量记录消费字段。 */
interface IConsumedFields {
  /** params 中已读取的字段。 */ params?: Set<string>;
  /** data 中已读取的字段。 */ data?: Set<string>;
  /** 标量请求体是否已消费。 */ removeData?: boolean;
}
/** 查询对象保留数组和特殊对象的既有取值语义。 */
function readParams(params: unknown, key: string, used: IConsumedFields): unknown {
  if (!isObject(params) || !(key in params)) return undefined;
  (used.params ??= new Set()).add(key);
  return params[key];
}
/** 请求体沿用对象标签和标量的原判定方式。 */
function readData(data: unknown, key: string, used: IConsumedFields): unknown {
  if (data == null) return undefined;
  if (toTag(data) === PLAIN_TAG) {
    const source = data as Record<string, unknown>;
    if (!(key in source)) return undefined;
    (used.data ??= new Set()).add(key);
    return source[key];
  }
  if (typeof data === "object" || typeof data === "function") return undefined;
  used.removeData = true;
  return data;
}
/** 只替换 pathname，params 优先于 data，按路径段编码。
 * @param options 匹配模式、字段消费规则与插件开关。
 * @returns 经 next(patch) 传递新请求视图的 prepare 插件。
 * @example `axpRepath({ removeKey: false })`
 */
export default function axpRepath<R extends IAxpResponse = AxpResponse>(options: IRepathOptions = {}): AxpPlugin<R> {
  const base = resolveOption<IRepathOptions, typeof DEFAULTS>(undefined, options, DEFAULTS);
  const basePattern = new RegExp(base.pattern.source, base.pattern.flags);
  return {
    name: NAME,
    enable: options.enable,
    stage: "prepare",
    /** 替换完毕后统一移除字段，重复变量仍可读取同一来源。 */
    async handle(ctx, next) {
      const resolved = resolveRequestOption(ctx.request.repath, base, DEFAULTS);
      const { url, params, data } = ctx.request;
      if (!resolved || !url) return next();
      const prefix = url.match(ORIGIN_PREFIX)?.[0] ?? "";
      const rest = url.slice(prefix.length);
      const suffixAt = rest.search(/[?#]/);
      const pathname = suffixAt < 0 ? rest : rest.slice(0, suffixAt);
      if (resolved.pattern === DEFAULT_PATTERN && !/[{[:]/.test(pathname)) return next();
      const suffix = rest.slice(pathname.length);
      const used: IConsumedFields = {};
      // 不向共享正则写 lastIndex；无捕获组时不把 replace 的 offset 当变量名。
      const pattern = resolved.pattern === base.pattern ? basePattern : new RegExp(resolved.pattern.source, resolved.pattern.flags);
      pattern.lastIndex = 0;
      const replaced = pathname.replace(
        pattern,
        /** 捕获组依次提供变量名。 */ (match, ...args: unknown[]) => {
          const captures = args.slice(0, -2);
          const key = captures.find(/** 忽略未命中的可选组。 */ (value) => typeof value === "string" && value.length > 0);
          if (typeof key !== "string") return match;
          const value = readParams(params, key, used) ?? readData(data, key, used);
          return value == null ? match : encodeURIComponent(toText(value));
        },
      );
      if (replaced === pathname) return next();
      return next({
        url: prefix + replaced + suffix,
        params: resolved.removeKey ? omit(params, used.params) : params,
        data: resolved.removeKey ? (used.removeData ? undefined : omit(data, used.data)) : data,
      });
    },
  };
}

declare module "../types" {
  interface AxpRequestOptions {
    /** 请求级关闭或按字段覆盖路径替换配置。 */
    repath?: AxpOption<IRepathOptions>;
  }
}
