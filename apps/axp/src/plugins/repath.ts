import type { Plugin } from '../types';
import { isObject, isPrimitive, __DEV__ } from '../helper';

export interface IRepathOptions {
    /**
     * 是否启用插件
     */
    enable?: boolean,
    /**
     * 自定义url变量匹配规则
     */
    pattern?: RegExp;
    /**
     * 当params,data命中url参数时，替换url参数的同时是否要从params,data中删除字段，默认true
     */
    removeKey?: boolean
}

const name = 'repath'

/**
 * 将路径变量替换成真实值（`{id}` / `:id` / `[id]` ← params / data）
 */
export default function repath(
    { enable = true, removeKey = true, pattern = /{([^}]+)}|\[([^\]]+)]|:([^/\s]+)/g }: IRepathOptions = {},
): Plugin {
    return {
        name: name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`)
            if (!enable) return;  // enable:false → 整个插件不安装拦截器（与 cache/share/filter 等一致）
            ctx.request(
                function $normalize(config) {
                    const { params, data } = config
                    config.url = config.url?.replace(pattern, (match, x, y, z) => {
                        const key = x || y || z;
                        if (!key) return match;
                        let value: any = null;

                        //try remove from params
                        if (params && key in params) {
                            value = params[key];
                            if (removeKey) {
                                delete params[key]
                            }
                        }

                        //fall back to data ONLY when params didn't supply the value
                        //（`==` on purpose: params[key] can legitimately be `undefined`,
                        // not just the `null` this variable starts at — either means "no value"）
                        if (value == null && data) {
                            if (isObject(data) && key in data) {
                                value = data[key];
                                if (removeKey) {
                                    delete data[key]
                                }
                            } else if (isPrimitive(data)) {
                                value = data;
                                if (removeKey) {
                                    delete config.data
                                }
                            }
                        }


                        return value ?? match;
                    });

                    return config;
                },
            );
        },
    };
}

// 见 normalize-response：严格模式 ESM 下 fn.name 须用 defineProperty 重定义
Object.defineProperty(repath, 'name', { value: name })
