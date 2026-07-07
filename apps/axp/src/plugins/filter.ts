
import type { Falsy, MaybeFun, Plugin } from '../types';
import { isObject, __DEV__ } from '../helper';
import type { AxiosRequestConfig } from 'axios';


const name = 'filter'

/**
 * 在请求发出前过滤掉 params / data 中的"空字段"，避免无意义的 key/value
 * 污染服务端日志、缓存或签名。
 *
 *   - 默认行为：丢掉 null / undefined / NaN / 空白字符串
 *   - predicate：自定义"是否丢弃"判断（返回 true → 丢弃）
 *   - ignoreKeys / ignoreValues：豁免过滤（即使 predicate 说要丢，也保留）
 *
 * 请求级 `config.filter` 可以是：
 *   - false / null / 0 / ''  → 该请求跳过过滤
 *   - true / undefined        → 走插件级默认
 *   - 对象                    → 覆盖插件级
 *   - 函数                    → 动态返回上述任一形式
 *
 * @returns 过滤 params / data，按需配合 key 等插件使用
 */
export default function filter({ enable = true, predicate, ignoreKeys, ignoreValues }: IFilterOptions = {}): Plugin {
    // 插件级默认（请求级未指定时回退到此）
    const defaults: IFilterOptions = { predicate, ignoreKeys, ignoreValues };
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`);
            ctx.request(
                function $normalize(config) {
                    const opts = $resolveOptions(config, defaults);
                    if (__DEV__) {
                        // dev 分支：收集丢弃条目并打印（生产构建时整块被 DCE）
                        const droppedParams: TDroppedKV[] = [];
                        const droppedData: TDroppedKV[] = [];
                        if (isObject(config.params)) config.params = $filter(config.params, opts, droppedParams);
                        if (isObject(config.data)) config.data = $filter(config.data, opts, droppedData);
                        if (droppedParams.length) ctx.logger.log(`${config.method?.toUpperCase()} ${config.url} dropped from params:`, Object.fromEntries(droppedParams));
                        if (droppedData.length) ctx.logger.log(`${config.method?.toUpperCase()} ${config.url} dropped from data:`, Object.fromEntries(droppedData));
                    } else {
                        if (isObject(config.params)) config.params = $filter(config.params, opts);
                        if (isObject(config.data)) config.data = $filter(config.data, opts);
                    }
                    delete config.filter;
                    return config;
                },
                null,
                {
                    runWhen: (config) => enable && isEnabled(config.filter),
                },
            );
        },
    };
}


/** runWhen 守卫：仅做廉价的真值判断，不解析 MaybeFun（那放到拦截器里做） */
function isEnabled(f: unknown): boolean {
    if (!f) return false;
    if (typeof f === 'string') return f.trim() !== ''
    return true;
}


/**
 * 解析请求级 config.filter（支持 MaybeFun + 对象/布尔），并与插件级 defaults 合并。
 * 优先级：请求级显式字段 > 插件级 defaults > 内置默认。
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
 * 对一层对象做条目级过滤（不递归——HTTP 序列化场景下嵌套结构由 key 等
 * 后续插件按需再处理；filter 只负责剥离顶层无意义字段）。
 *
 *   - key 命中 ignoreKeys → 保留
 *   - value 命中 ignoreValues → 保留
 *   - predicate(kv) === true → 丢弃
 *   - 其他 → 保留
 *
 * 可选的 dropped 出参：传入空数组以收集被丢弃的 [key, value] 条目（用于调试日志）。
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


export type TDroppedKV = [key: string, value: any];


/** 默认 predicate：与 key 的默认过滤语义对齐 */
export function defaultPredicate(kv: [key: string, value: any]): boolean {
    const v = kv[1];
    if (v == null || Number.isNaN(v)) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    return false;
}


/** ignoreValues 命中检测（=== 比较 + NaN 特例） */
function matchesValue(target: any, list: any[]): boolean {
    const targetIsNaN = Number.isNaN(target);
    for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (v === target) return true;
        if (targetIsNaN && Number.isNaN(v)) return true;
    }
    return false;
}


export type TPredicate = (kv: [key: string, value: any]) => boolean;

export interface IFilterOptions {
    /** 插件级总开关；默认 `true` */
    enable?: boolean;
    /** 自定义"是否丢弃"判断；返回 `true` 表示该条目被丢弃 */
    predicate?: TPredicate;
    /** 这些 key 即使 predicate 说要丢也保留 */
    ignoreKeys?: string[];
    /** 这些 value 即使 predicate 说要丢也保留（=== 比较，NaN 特例） */
    ignoreValues?: any[];
}


declare module 'axios' {
    interface AxiosRequestConfig {
        filter?: MaybeFun<IFilterOptions | boolean | Falsy>;
    }
    interface InternalAxiosRequestConfig {
        // filter?: IFilterOptions | boolean | Falsy;
    }
}
