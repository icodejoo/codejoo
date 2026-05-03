import type { Falsy, MaybeFunc } from '../../helper';


export type TDroppedKV = [key: string, value: any];

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
    /**
     * 是否对 params/data 内嵌套的对象 / 数组也递归过滤。
     *   - `false` / 未指定（默认）：仅过滤顶层条目（性能优先；嵌套结构由 key 等下游插件按需处理）
     *   - `true`：递归过滤；空对象 / 空数组在过滤后仍保留为空容器，不会被当作"空"丢弃
     * @default false
     */
    deep?: boolean;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        filter?: MaybeFunc<IFilterOptions | boolean | Falsy>;
    }
}
