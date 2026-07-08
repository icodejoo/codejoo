
import type { Plugin } from '../types';
import { pluginLog } from '../helper';
import type { CreateAxiosDefaults } from 'axios';


const name = 'axp:envs'

/**
 * 多环境配置插件：install 时按 `rule()` 选第一个匹配的配置，浅合并到 `axios.defaults`。无拦截器，纯 install-time 行为零运行时开销；命中后 break，余下规则不再求值；无匹配则 no-op。
 *
 * Multi-environment plugin: at install time, picks the first rule whose `rule()` matches and shallow-merges its `config` into `axios.defaults`. No interceptors, zero runtime overhead; stops at first match; no-op if nothing matches.
 *
 * @example
 *   Axp.install(axiosInstance, { envs: envs([
 *     { rule: () => import.meta.env.DEV,  config: { baseURL: 'http://dev'  } },
 *     { rule: () => import.meta.env.PROD, config: { baseURL: 'http://prod' } },
 *   ]) });
 */
export default function axpEnvs(rules: IEnvRule[] = []): Plugin {
    return {
        name,
        install(axios) {
            for (const r of rules) {
                if (r.rule()) {
                    pluginLog(axios.defaults, `[${name}] matched:`, describe(r));
                    // 直接改 axios.defaults——自己存快照，返回的 cleanup 负责复原。
                    const prev: Record<string, unknown> = {};
                    for (const k of Object.keys(r.config)) {
                        prev[k] = (axios.defaults as Record<string, unknown>)[k];
                    }
                    Object.assign(axios.defaults, r.config);
                    return () => { Object.assign(axios.defaults, prev); };
                }
            }
            pluginLog(axios.defaults, `[${name}] no rule matched`);
        },
    };
}


/** 把规则的描述压成一行（dev 日志用）/ condenses a rule's description into one line (for dev logging) */
function describe(r: IEnvRule): string {
    const c = r.config as any;
    return c?.baseURL ?? c?.name ?? '<config>';
}


export interface IEnvRule {
    /** 规则判定，返回 true 的第一条会被采用 / matching predicate; first rule returning true is adopted */
    rule: () => boolean;
    /** 该环境对应的 axios 默认配置（浅合并到 `axios.defaults`）/ the axios defaults for this environment (shallow-merged into `axios.defaults`) */
    config: CreateAxiosDefaults;
}

/** `axpEnvs` 的输入：一组按顺序尝试的环境规则 / the input to `axpEnvs`: a list of environment rules tried in order */
export type IEnvsOptions = IEnvRule[];
