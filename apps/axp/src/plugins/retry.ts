
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';


const name = 'retry'

/**
 * 失败重试插件：请求失败后最多重试 N 次，全部失败再抛出最后一次的异常。
 *
 *   - **触发条件**：默认仅在 axios 抛异常（`onRejected`）时触发重试；
 *     若提供 `isExceptionRequest`，则在 `onFulfilled` 阶段也按其结果决定是否重试
 *     （把"业务上认定为失败的成功响应"也纳入重试逻辑）
 *   - **次数来源优先级**：`config.retry` 数字 > `config.retry.max` > 插件级 `defaults.max` > 0
 *   - **每次重试通过 `ctx.axios.request(config)` 重新走完整链路**——
 *     其他拦截器（如 share/loading）会再跑一遍；count 用 WeakMap 按 config 对象记
 *   - **最大次数后**：清理计数并 reject 最后一次的 error，链路下游正常 catch
 *
 * @example
 *   useAxiosPlugin(ax).use(retry({ max: 3 }))
 *   // 单请求覆盖
 *   ax.get('/api', { retry: 5 })
 *   ax.get('/api', { retry: { max: 5, isExceptionRequest: r => r.data.code !== 0 } })
 */
export default function retry({ enable = true, max = 0, isExceptionRequest }: IRetryOptions = {}): Plugin {
    const defaults: IRetryOptions = { max, isExceptionRequest };
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable} max:${max}`);
            if (!enable) return;

            const counts = new WeakMap<object, number>();

            const attempt = (config: AxiosRequestConfig, err: any): Promise<any> => {
                const m = $resolveMax(config, defaults);
                if (m <= 0) return Promise.reject(err);
                const c = (counts.get(config) ?? 0) + 1;
                if (c > m) {
                    counts.delete(config);
                    return Promise.reject(err);
                }
                counts.set(config, c);
                if (__DEV__) ctx.logger.log(`${name} retry ${c}/${m} ${(config.method ?? '').toUpperCase()} ${config.url}`);
                return ctx.axios.request(config);
            };

            ctx.response(
                async (response) => {
                    const config = response.config;
                    const exc = $resolveException(config, defaults);
                    if (exc && exc(response)) return attempt(config, response);
                    counts.delete(config);
                    return response;
                },
                async (error: any) => {
                    const config = error?.config;
                    if (!config) return Promise.reject(error);
                    return attempt(config, error);
                },
            );
        },
    };
}


/** 解析最大重试次数：请求级 > 插件级 > 0 @internal */
export function $resolveMax(config: AxiosRequestConfig, defaults: IRetryOptions): number {
    const v = config.retry;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && v && typeof v.max === 'number') return v.max;
    return defaults.max ?? 0;
}

/** 解析"业务异常判定"函数：请求级 > 插件级 > undefined @internal */
export function $resolveException(config: AxiosRequestConfig, defaults: IRetryOptions): TIsException | undefined {
    const v = config.retry;
    if (typeof v === 'object' && v && typeof v.isExceptionRequest === 'function') return v.isExceptionRequest;
    return defaults.isExceptionRequest;
}


export type TIsException = (response: AxiosResponse) => boolean;

export interface IRetryOptions {
    /** 插件级总开关；默认 `true`。设为 `false` 时整个插件不安装。 */
    enable?: boolean;
    /** 默认最大重试次数；可由请求级 `config.retry` 覆盖。默认 `0`（不重试）。 */
    max?: number;
    /** 自定义"成功响应也算失败"的判定函数；返回 true 触发重试。 */
    isExceptionRequest?: TIsException;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 失败重试配置：
         *   - `number`              → 设置最大重试次数
         *   - `{ max, isExceptionRequest }` → 完整配置
         *   - 未指定                → 走插件级默认
         */
        retry?: number | Pick<IRetryOptions, 'max' | 'isExceptionRequest'>;
    }
}
