import type { Plugin } from '../types';
import { Type, __DEV__ } from '../helper';

export interface PathVariableOptions {
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

const name = 'replace-path-vars'

/** 
 * 将路径变量替换成真实值
 */
export default function replacePathVars(
    { enable = true, removeKey = true, pattern = /{([^}]+)}|\[([^\]]+)]|:([^\s]+)/g }: PathVariableOptions = {},
): Plugin {
    return {
        name: name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`)
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

                        //try remove from data
                        if (value !== null && data) {
                            if (Type.isObject(data) && key in data) {
                                value = data[key];
                                if (removeKey) {
                                    delete data[key]
                                }
                            } else if (Type.isPrimitive(data)) {
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

replacePathVars.name = name
