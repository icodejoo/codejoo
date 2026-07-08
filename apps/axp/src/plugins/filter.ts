
import type { Falsy, MaybeFun, Plugin } from '../types';
import { isObject, pluginLog } from '../helper';
import type { AxiosRequestConfig } from 'axios';


const name = 'axp:filter'

/**
 * 在请求发出前过滤掉 params/data 中的"空字段"，避免无意义的 key/value 污染服务端日志、缓存或签名。默认丢掉 null/undefined/NaN/空白字符串；`predicate` 可自定义丢弃判断，`ignoreKeys`/`ignoreValues` 豁免过滤。请求级 `config.filter` 可为 falsy(跳过)/true/undefined(走插件默认)/对象(覆盖)/函数(动态返回以上任一)。
 *
 * Filters "empty fields" out of params/data before sending, so meaningless key/values don't pollute server logs/cache/signatures. Drops null/undefined/NaN/whitespace by default; `predicate` customizes the drop check, `ignoreKeys`/`ignoreValues` exempt entries. Request-level `config.filter` can be falsy (skip)/true/undefined (plugin defaults)/object (override)/function (dynamically returns any of the above).
 */
export default function axpFilter({ enable = true, predicate, ignoreKeys, ignoreValues }: IFilterOptions = {}): Plugin {
    // 插件级默认（请求级未指定时回退到此）
    const defaults: IFilterOptions = { predicate, ignoreKeys, ignoreValues };
    return {
        name,
        install(axios) {
            pluginLog(axios.defaults, `[${name}] enabled:${enable}`);
            const id = axios.interceptors.request.use(
                /** 解析过滤选项并过滤 params/data，记录丢弃日志 / resolves filter options, filters params/data, logs drops */
                function $normalize(config) {
                    const opts = $resolveOptions(config, defaults);
                    const droppedParams: TDroppedKV[] = [];
                    const droppedData: TDroppedKV[] = [];
                    if (isObject(config.params)) config.params = $filter(config.params, opts, droppedParams);
                    if (isObject(config.data)) config.data = $filter(config.data, opts, droppedData);
                    if (droppedParams.length) pluginLog(config, `[${name}] ${config.method?.toUpperCase()} ${config.url} dropped from params:`, Object.fromEntries(droppedParams));
                    if (droppedData.length) pluginLog(config, `[${name}] ${config.method?.toUpperCase()} ${config.url} dropped from data:`, Object.fromEntries(droppedData));
                    delete config.filter;
                    return config;
                },
                null,
                {
                    runWhen: (config) => enable && isEnabled(config.filter),
                },
            );
            return () => { axios.interceptors.request.eject(id); };
        },
    };
}


/** runWhen 守卫：仅做廉价真值判断，不解析 MaybeFun（留给拦截器）/ runWhen guard: cheap truthiness only, `MaybeFun` resolution deferred to the interceptor */
function isEnabled(f: unknown): boolean {
    if (!f) return false;
    if (typeof f === 'string') return f.trim() !== ''
    return true;
}


/**
 * 解析请求级 config.filter（支持 MaybeFun + 对象/布尔），与插件级 defaults 合并。优先级：请求级显式字段 > 插件级 defaults > 内置默认。
 *
 * Resolves the request-level `config.filter` (supports `MaybeFun` + object/boolean) and merges with plugin-level `defaults`. Priority: explicit request field > plugin `defaults` > built-in default.
 *
 * @internal exported for unit tests
 */
export function $resolveOptions(
    config: AxiosRequestConfig,
    defaults: IFilterOptions,
): Required<Pick<IFilterOptions, 'predicate'>> & Pick<IFilterOptions, 'ignoreKeys' | 'ignoreValues'> {
    let f = config.filter;
    if (typeof f === 'function') f = f(config);
    const override: IFilterOptions = (f && typeof f === 'object') ? f : {};
    return {
        predicate: override.predicate ?? defaults.predicate ?? defaultPredicate,
        ignoreKeys: override.ignoreKeys ?? defaults.ignoreKeys,
        ignoreValues: override.ignoreValues ?? defaults.ignoreValues,
    };
}


/**
 * 对一层对象做条目级过滤（不递归——嵌套结构由 key 等后续插件按需处理；filter 只剥离顶层无意义字段）。key 命中 ignoreKeys 或 value 命中 ignoreValues → 保留；predicate(kv) === true → 丢弃；其余保留。可选 `dropped` 出参收集被丢弃条目（调试日志用）。
 *
 * Filters entries of a single (non-nested) object — nesting is left to downstream plugins like key; `filter` only strips meaningless top-level fields. Kept if key matches `ignoreKeys` or value matches `ignoreValues`; dropped if `predicate(kv) === true`. Optional `dropped` out-param collects dropped entries for debug logging.
 *
 * @internal exported for unit tests
 */
export function $filter(
    obj: Record<string, any>,
    opts: { predicate: TPredicate; ignoreKeys?: string[]; ignoreValues?: any[] },
    dropped?: TDroppedKV[],
): Record<string, any> {
    const { predicate, ignoreKeys, ignoreValues } = opts;
    const hasKeys = !!ignoreKeys?.length;
    const hasVals = !!ignoreValues?.length;
    const out: Record<string, any> = {};
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const val = obj[key];
        if (hasKeys && ignoreKeys!.includes(key)) { out[key] = val; continue; }
        if (hasVals && matchesValue(val, ignoreValues!)) { out[key] = val; continue; }
        if (predicate([key, val])) {
            dropped?.push([key, val]);
            continue;
        }
        out[key] = val;
    }
    return out;
}


/** 被 `$filter` 丢弃的一条 [key, value] 条目 / a `[key, value]` entry dropped by `$filter` */
export type TDroppedKV = [key: string, value: any];


/** 默认 predicate：与 key 插件的默认过滤语义对齐 / default predicate: aligned with the key plugin's default filtering semantics */
export function defaultPredicate(kv: [key: string, value: any]): boolean {
    const v = kv[1];
    if (v == null || Number.isNaN(v)) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    return false;
}


/** ignoreValues 命中检测（=== 比较 + NaN 特例）/ ignoreValues match check (`===` comparison, NaN special case) */
function matchesValue(target: any, list: any[]): boolean {
    const targetIsNaN = Number.isNaN(target);
    for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (v === target) return true;
        if (targetIsNaN && Number.isNaN(v)) return true;
    }
    return false;
}


/** 自定义"是否丢弃"判断，返回 `true` 表示该条目应被丢弃 / custom drop predicate; `true` means the entry should be dropped */
export type TPredicate = (kv: [key: string, value: any]) => boolean;

export interface IFilterOptions {
    /** 插件级总开关；默认 `true` / plugin-level master switch; default `true` */
    enable?: boolean;
    /** 自定义"是否丢弃"判断；返回 `true` 表示该条目被丢弃 / custom drop check; `true` means the entry is dropped */
    predicate?: TPredicate;
    /** 这些 key 即使 predicate 说要丢也保留 / these keys are kept even if `predicate` says to drop them */
    ignoreKeys?: string[];
    /** 这些 value 即使 predicate 说要丢也保留（=== 比较，NaN 特例）/ these values are kept even if `predicate` says to drop them (`===`, NaN special case) */
    ignoreValues?: any[];
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /** 请求级过滤配置，缺省回退插件级 defaults / request-level filter config, falls back to plugin defaults when omitted */
        filter?: MaybeFun<IFilterOptions | boolean | Falsy>;
    }
    interface InternalAxiosRequestConfig {
        // filter?: IFilterOptions | boolean | Falsy;
    }
}
