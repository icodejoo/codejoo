import type { Plugin } from '../../plugin/types';
import { Type, __DEV__, isRetry, lockName } from '../../helper';
import type { IReurlOptions } from './types';


export const name = 'reurl'


/**
 * URL 重整：路径变量替换 + baseURL/url 分隔符规整。
 *
 *   - 默认正则匹配 `{var}` / `[var]` / `:var` 三种语法
 *   - 命中时优先从 params 取，再从 data 取（primitive 直接消费，object 取同名字段）
 *   - `removeKey: true`（默认）会把已替换的字段从 params/data 中删除，避免重复参数
 *   - `fixSlash: true`（默认）规整 baseURL 与 url 之间的分隔符——补齐缺失的 `/`、压掉多余的 `//`
 *   - **重试请求短路**：首发已替换好 url，重试时 params/data 中的字段早已删除，再跑一遍是 no-op
 */
export default function reurl(
    {
        enable = true,
        removeKey = true,
        fixSlash = true,
        pattern = /{([^}]+)}|\[([^\]]+)]|(?<!:):([^\s/?#&=]+)/g,
    }: IReurlOptions = {},
): Plugin {
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`)
            ctx.request(
                function $normalize(config) {
                    if (!enable) return config;
                    if (isRetry(config)) return config;
                    const { params, data } = config
                    config.url = config.url?.replace(pattern, (match, x, y, z) => {
                        const key = x || y || z;
                        if (!key) return match;
                        let value: any = null;

                        // try params first
                        if (params && key in params) {
                            value = params[key];
                            if (removeKey) delete params[key];
                        }

                        // fall through to data only if params didn't supply a value
                        // (bug fix: prior code used `value !== null && data` which inverted the fallback)
                        if (value == null && data) {
                            if (Type.isObject(data) && key in data) {
                                value = data[key];
                                if (removeKey) delete data[key];
                            } else if (Type.isPrimitive(data)) {
                                value = data;
                                if (removeKey) delete config.data;
                            }
                        }

                        return value ?? match;
                    });

                    if (fixSlash && config.url) {
                        config.url = $fixSlash(config.url, config.baseURL);
                    }

                    return config;
                },
            );
        },
    };
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(reurl)` 在 minify 后仍能识别
lockName(reurl, name);


/**
 * 规整 url 自身与 baseURL 之间的分隔符。
 *
 *   - url 为绝对地址（含 `://`）：仅压缩 path 段中的 `//`，protocol 不动
 *   - url 为相对路径：根据 baseURL 末尾是否带 `/` 调整 url 开头，
 *     最终送给 axios 的 url 与 baseURL 之间恰好 1 个 `/`
 *
 * @internal exported for unit tests
 */
export function $fixSlash(url: string, baseURL?: string): string {
    // 绝对 URL：保留 protocol，压缩其余的 //
    const protoIdx = url.indexOf('://');
    if (protoIdx !== -1) {
        const proto = url.slice(0, protoIdx + 3);
        const rest = url.slice(protoIdx + 3).replace(/\/{2,}/g, '/');
        return proto + rest;
    }

    // 先压缩 url 自身连续 /
    let u = url.replace(/\/{2,}/g, '/');

    if (!baseURL) return u;

    const baseEndsSlash = baseURL.endsWith('/');
    const urlStartsSlash = u.startsWith('/');

    if (baseEndsSlash && urlStartsSlash) {
        // baseURL='/api/' + url='/x' ⇒ 去掉 url 开头的 /
        u = u.replace(/^\/+/, '');
    } else if (!baseEndsSlash && !urlStartsSlash) {
        // baseURL='/api' + url='x' ⇒ 给 url 补一个 /
        u = '/' + u;
    }
    return u;
}