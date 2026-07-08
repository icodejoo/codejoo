import type { Plugin } from '../types';
import { isObject, isPrimitive, pluginLog } from '../helper';

export interface IRepathOptions {
    /** 是否启用插件 / whether to enable this plugin */
    enable?: boolean,
    /** 自定义 url 变量匹配规则 / custom regex for matching URL path variables */
    pattern?: RegExp;
    /** params/data 命中 url 参数时，替换的同时是否从 params/data 中删除该字段，默认 true / whether to also delete the field from params/data after substitution, default true */
    removeKey?: boolean
}

const name = 'axp:repath'

/**
 * 将路径变量替换成真实值（`{id}` / `:id` / `[id]` ← params / data）。
 *
 * Substitutes path variables (`{id}` / `:id` / `[id]`) in the URL with values from `params`/`data`.
 */
export default function axpRepath(
    { enable = true, removeKey = true, pattern = /{([^}]+)}|\[([^\]]+)]|:([^/\s]+)/g }: IRepathOptions = {},
): Plugin {
    return {
        name: name,
        install(axios) {
            pluginLog(axios.defaults, `[${name}] enabled:${enable}`)
            if (!enable) return;  // enable:false → 整个插件不安装拦截器（与 cache/share/filter 等一致）
            const id = axios.interceptors.request.use(
                /** 用 pattern 匹配 url 中的变量，从 params/data 取值替换 / matches url variables via `pattern`, substituting values from params/data */
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
            return () => { axios.interceptors.request.eject(id); };
        },
    };
}

// 见 normalize：严格模式 ESM 下 fn.name 须用 defineProperty 重定义
Object.defineProperty(axpRepath, 'name', { value: name })
