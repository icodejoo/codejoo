
import type { Plugin } from '../../plugin/types';
import { __DEV__ , lockName} from '../../helper';
import type { IEnvRule, IEnvsOptions } from './types';


export const name = 'envs';


/**
 * 多环境配置插件 —— **install 时**根据 `default` 选定 env，去 `rules` 列表查找命中的规则，
 * 把它的 `config` 浅合并到 `axios.defaults`。
 *
 *   - **`default`** ⇒ env 选择器：字面量直接当 env 名，函数调用一次得到 env 名
 *   - **`rules[].rule`** ⇒ 候选 env 表：同样支持字面量或函数（每条 rule 各自解析后比对）
 *   - **匹配**：`resolve(default) === resolve(rules[i].rule)` 命中第一条；命中即合并到
 *     `axios.defaults`，其余 rule 不再求值
 *   - **未命中**：no-op + dev warn —— 不擅自 fallback，避免静默吞错
 *
 * 没有任何拦截器，纯 install-time 行为，运行时零开销。
 *
 * @example
 *   use(envs({
 *     enable: true,
 *     // 选择器：函数返回当前 env 名
 *     default: () => (import.meta.env.PROD ? 'prod' : 'dev'),
 *     rules: [
 *       { rule: 'dev',  config: { baseURL: 'http://dev'  } },
 *       { rule: 'prod', config: { baseURL: 'http://prod' } },
 *     ],
 *   }));
 *
 * @example
 *   // 也支持字面量 default —— 等于显式钉死某个环境
 *   use(envs({
 *     enable: true,
 *     default: 'staging',
 *     rules: [
 *       { rule: 'staging', config: { baseURL: 'http://staging' } },
 *       { rule: 'prod',    config: { baseURL: 'http://prod'    } },
 *     ],
 *   }));
 */
export default function envs({
    enable,
    default: def,
    rules = [],
}: IEnvsOptions): Plugin {
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable} rules:${rules.length}`);
            if (!enable) return;

            const envName = $resolve(def);
            const matched = rules.find((r) => $resolve(r.rule) === envName);

            if (!matched) {
                if (__DEV__) {
                    ctx.logger.warn(
                        `${name} no rule matched: env=${String(envName)}`,
                    );
                }
                return;
            }

            if (__DEV__) {
                ctx.logger.log(
                    `${name} matched: ${String(envName)} → ${$describe(matched)}`,
                );
            }
            Object.assign(ctx.axios.defaults, matched.config);
        },
    };
}


/** 解开 rule —— 函数 ⇒ 调用一次取返回值；字面量 ⇒ 原样 */
function $resolve(rule: IEnvRule['rule']): string | number | symbol {
    if (typeof rule === 'function') {
        return (rule as (ctx: null) => string | number | symbol)(null);
    }
    return rule as string | number | symbol;
}


/** 把规则压成一行（dev 日志用） */
function $describe(r: IEnvRule): string {
    const c = r.config as { baseURL?: string; name?: string };
    return c?.baseURL ?? c?.name ?? '<config>';
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(envs)` 在 minify 后仍能识别
lockName(envs, name);
