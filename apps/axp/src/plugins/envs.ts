
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';
import type { CreateAxiosDefaults } from 'axios';


const name = 'envs'

/**
 * 多环境配置插件：在插件 install 时按 `rule()` 选第一个匹配的配置，
 * 把 `config` 浅合并到 `axios.defaults`。
 *
 *   - 没有任何拦截器，纯 install-time 行为，运行时零开销
 *   - 第一个匹配命中后 break，余下规则不再求值
 *   - 没规则匹配时 → no-op（不报错，避免影响构建）
 *
 * @example
 *   useAxiosPlugin(ax).use(envs([
 *     { rule: () => import.meta.env.DEV,  config: { baseURL: 'http://dev'  } },
 *     { rule: () => import.meta.env.PROD, config: { baseURL: 'http://prod' } },
 *   ]));
 */
export default function envs(rules: IEnvRule[] = []): Plugin {
    return {
        name,
        install(ctx) {
            for (const r of rules) {
                if (r.rule()) {
                    if (__DEV__) ctx.logger.log(`${name} matched: ${describe(r)}`);
                    // Object.assign 直接改 axios.defaults，PluginManager 的 teardown 不认识这个
                    // 副作用（它只反转 ctx.request/response/adapter/transform*）——自己存快照，
                    // 用 ctx.cleanup 注册回滚，让 eject / #refresh 时 defaults 能真正复原。
                    const prev: Record<string, unknown> = {};
                    for (const k of Object.keys(r.config)) {
                        prev[k] = (ctx.axios.defaults as Record<string, unknown>)[k];
                    }
                    Object.assign(ctx.axios.defaults, r.config);
                    ctx.cleanup(() => Object.assign(ctx.axios.defaults, prev));
                    return;
                }
            }
            if (__DEV__) ctx.logger.log(`${name} no rule matched`);
        },
    };
}


/** 把规则的描述压成一行（dev 日志用） */
function describe(r: IEnvRule): string {
    const c = r.config as any;
    return c?.baseURL ?? c?.name ?? '<config>';
}


export interface IEnvRule {
    /** 规则判定，返回 true 的第一条会被采用 */
    rule: () => boolean;
    /** 该环境对应的 axios 默认配置（浅合并到 `axios.defaults`） */
    config: CreateAxiosDefaults;
}

export type IEnvsOptions = IEnvRule[];
