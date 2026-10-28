import type { Plugin } from '../types';
import { isObject, isPrimitive, pluginLog } from '../helper';

/** 路径变量插件配置。 */
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
 * @param options 匹配规则、启用状态与字段删除策略。
 * @returns 可安装到 axios 的路径变量插件。
 * @example axpRepath({ removeKey: false })
 */
export default function axpRepath(
    { enable = true, removeKey = true, pattern = /{([^}]+)}|\[([^\]]+)]|:([^/\s]+)/g }: IRepathOptions = {},
): Plugin {
    return {
        name: name,
        /** 安装路径变量请求拦截器，返回卸载函数。 */
        install(axios) {
            pluginLog(axios.defaults, `[${name}] enabled:${enable}`)
            if (!enable) return;  // enable:false → 整个插件不安装拦截器（与 cache/share/filter 等一致）
            const id = axios.interceptors.request.use(
                /** 用 pattern 匹配 url 中的变量，从 params/data 取值替换 / matches url variables via `pattern`, substituting values from params/data */
                function $normalize(config) {
                    const { params, data, url } = config
                    if (!url) return config;
                    // 保留 authority，以及 query/hash 的原始文本。
                    const prefix = url.match(/^(?:[a-z][a-z\d+.-]*:)?\/\/[^/?#]*/i)?.[0] ?? '';
                    const rest = url.slice(prefix.length);
                    const suffixAt = rest.search(/[?#]/);
                    const pathname = suffixAt < 0 ? rest : rest.slice(0, suffixAt);
                    const suffix = suffixAt < 0 ? '' : rest.slice(suffixAt);
                    const paramsKeys = new Set<string>();
                    const dataKeys = new Set<string>();
                    let removeData = false;
                    config.url = prefix + pathname.replace(pattern, (match, x, y, z) => {
                        const key = x || y || z;
                        if (!key) return match;
                        let value: any = null;

                        //try remove from params
                        if (params && key in params) {
                            value = params[key];
                            paramsKeys.add(key);
                        }

                        //fall back to data ONLY when params didn't supply the value
                        //（`==` on purpose: params[key] can legitimately be `undefined`,
                        // not just the `null` this variable starts at — either means "no value"）
                        if (value == null && data != null) {
                            if (isObject(data) && key in data) {
                                value = data[key];
                                dataKeys.add(key);
                            } else if (isPrimitive(data)) {
                                value = data;
                                removeData = true;
                            }
                        }
                        
                        return value == null ? match : encodeURIComponent(String(value));
                    }) + suffix;

                    if (removeKey) {
                        for (const key of paramsKeys) delete params[key];
                        for (const key of dataKeys) delete data[key];
                        if (removeData) delete config.data;
                    }

                    return config;
                },
            );
            return () => { axios.interceptors.request.eject(id); };
        },
    };
}

// 见 normalize：严格模式 ESM 下 fn.name 须用 defineProperty 重定义
Object.defineProperty(axpRepath, 'name', { value: name })
