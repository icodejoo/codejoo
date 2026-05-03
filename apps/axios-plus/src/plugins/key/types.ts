import type { IPluginCommonRequestOptions } from '../../plugin/types';
import type { MaybeFunc } from '../../helper';


export interface IKeyOptions extends IPluginCommonRequestOptions, IKeyObject {
}


export interface IKeyObject {
    enable?: boolean;
    /**
     * 是否启用简单模式。
     *   - `true`: 仅使用 method+url，性能最高
     *   - `false`: 使用 method+url+params+data，准确度最高
     * @default false
     */
    fastMode?: boolean;
    /** 哪些值不参与过滤 */
    ignoreValues?: any[];
    /** 哪些键不参与过滤 */
    ignoreKeys?: any[];
}


/** @internal — `$key` 的 ignore 配置子集 */
export interface KeyOpts {
    ignoreValues?: any[];
    ignoreKeys?: any[];
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 请求级 key 配置：
         *   - `true`         → 启用，使用插件级 fastMode 与 ignore 列表
         *   - `'deep'`       → 强制 deep 模式（method+url+params+data）
         *   - `number`       → 直接当字符串 key 使用
         *   - `string`       → 直接作为 key（trim 后非空时）
         *   - `IKeyObject`   → 字段级覆盖（fastMode / ignoreKeys / ignoreValues）
         *   - 函数            → 动态返回字符串 key
         */
        key?: MaybeFunc<'deep' | IKeyObject | number | null | undefined | void | boolean | ({} & string)>;
    }
    interface InternalAxiosRequestConfig {
        key?: string;
    }
}
