
import type { Plugin } from '../../plugin/types';
import { Type, __DEV__, isRetry, tagOf , lockName} from '../../helper';
import type { AxiosRequestConfig } from 'axios';
import type { IFilterOptions, TDroppedKV, TPredicate } from './types';


export const name = 'filter'

/**
 * 在请求发出前过滤掉 params / data 中的"空字段"，避免无意义的 key/value
 * 污染服务端日志、缓存或签名。
 *
 *   - 默认行为：丢掉 null / undefined / NaN / 空白字符串
 *   - predicate：自定义"是否丢弃"判断（返回 true → 丢弃）
 *   - ignoreKeys / ignoreValues：豁免过滤（即使 predicate 说要丢，也保留）
 *   - **重试请求短路**：首发已经过滤过，重试时 params/data 已是稳定形态，直接 return
 *
 * 请求级 `config.filter` 可以是：
 *   - false / null / 0 / ''  → 该请求跳过过滤
 *   - true / undefined        → 走插件级默认
 *   - 对象                    → 覆盖插件级
 *   - 函数                    → 动态返回上述任一形式
 *
 * @returns 过滤 params / data，按需配合 key 等插件使用
 */
export default function filter({ enable = true, predicate, ignoreKeys, ignoreValues, deep = false }: IFilterOptions = {}): Plugin {
    // 插件级默认（请求级未指定时回退到此）
    const defaults: IFilterOptions = { predicate, ignoreKeys, ignoreValues, deep };
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`);
            ctx.request(
                function $normalize(config) {
                    // 重试请求 params/data 已被首发过滤过，省一次遍历
                    if (isRetry(config)) return config;
                    const opts = $resolveOptions(config, defaults);
                    if (__DEV__) {
                        // dev 分支：收集丢弃条目并打印（生产构建时整块被 DCE）
                        const droppedParams: TDroppedKV[] = [];
                        const droppedData: TDroppedKV[] = [];
                        if (Type.isObject(config.params)) config.params = $filter(config.params, opts, droppedParams);
                        if (Type.isObject(config.data)) config.data = $filter(config.data, opts, droppedData);
                        if (droppedParams.length) ctx.logger.log(`${tagOf(config)} dropped from params:`, Object.fromEntries(droppedParams));
                        if (droppedData.length) ctx.logger.log(`${tagOf(config)} dropped from data:`, Object.fromEntries(droppedData));
                    } else {
                        if (Type.isObject(config.params)) config.params = $filter(config.params, opts);
                        if (Type.isObject(config.data)) config.data = $filter(config.data, opts);
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
): Required<Pick<IFilterOptions, 'predicate'>> & Pick<IFilterOptions, 'ignoreKeys' | 'ignoreValues' | 'deep'> {
    let f = config.filter;
    if (typeof f === 'function') f = f(config);
    const override: IFilterOptions = (f && typeof f === 'object') ? f : {};
    return {
        predicate: override.predicate ?? defaults.predicate ?? defaultPredicate,
        ignoreKeys: override.ignoreKeys ?? defaults.ignoreKeys,
        ignoreValues: override.ignoreValues ?? defaults.ignoreValues,
        deep: override.deep ?? defaults.deep,
    };
}


/**
 * 对对象做条目级过滤。
 *
 *   - key 命中 ignoreKeys → 保留
 *   - value 命中 ignoreValues → 保留
 *   - predicate(kv) === true → 丢弃
 *   - 其他 → 保留
 *   - `deep: true` 时，对嵌套对象 / 数组递归过滤；空容器在过滤后仍以空容器形式保留
 *
 * 可选的 dropped 出参：传入空数组以收集被丢弃的 [key, value] 条目（用于调试日志）。
 *
 * @internal exported for unit tests
 */
export function $filter(
    obj: Record<string, any>,
    opts: { predicate: TPredicate; ignoreKeys?: string[]; ignoreValues?: any[]; deep?: boolean },
    dropped?: TDroppedKV[],
): Record<string, any> {
    const { predicate, ignoreKeys, ignoreValues, deep } = opts;
    const hasKeys = !!ignoreKeys?.length;
    const hasVals = !!ignoreValues?.length;
    const out: Record<string, any> = {};
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        let val = obj[key];
        if (hasKeys && ignoreKeys!.includes(key)) { out[key] = val; continue; }
        if (hasVals && matchesValue(val, ignoreValues!)) { out[key] = val; continue; }
        if (deep && val !== null && typeof val === 'object' && !Type.isArray(val) && !(val instanceof Date)) {
            val = $filter(val, opts);
        } else if (deep && Type.isArray(val)) {
            val = $filterArray(val, opts);
        }
        if (predicate([key, val])) {
            dropped?.push([key, val]);
            continue;
        }
        out[key] = val;
    }
    return out;
}


/** deep 模式下对数组的递归过滤：对每个对象元素递归 $filter，原始 primitive 不动 @internal */
function $filterArray(
    arr: any[],
    opts: { predicate: TPredicate; ignoreKeys?: string[]; ignoreValues?: any[]; deep?: boolean },
): any[] {
    const out: any[] = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v !== null && typeof v === 'object' && !Type.isArray(v) && !(v instanceof Date)) {
            out[i] = $filter(v, opts);
        } else if (Type.isArray(v)) {
            out[i] = $filterArray(v, opts);
        } else {
            out[i] = v;
        }
    }
    return out;
}


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


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(filter)` 在 minify 后仍能识别
lockName(filter, name);
