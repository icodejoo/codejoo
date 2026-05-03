
import type { Plugin } from '../../plugin/types';
import { __DEV__, createAborter , lockName} from '../../helper';
import type { ICancelOptions } from './types';


export const name = 'cancel';

/** 默认组名 —— `aborter` 解析为 true / null / undefined / AbortController 时落到这里 */
const DEFAULT_GROUP = '__default__';

/** 全局共享：「分组 → 活跃 controller 集合」 —— 跨所有 axios 实例共用 */
const groups = new Map<string, Set<AbortController>>();

/** config 内部字段名 —— 仅本插件使用，settle 后立即清理 */
const CTRL_KEY = '_cancel_ctrl';
const GROUP_KEY = '_cancel_group';
/**
 * 持久化"原始 aborter 意图"—— 跨重发（retry / auth refresh / auth replay）存活。
 * 仅在 `string`（命名组）/ `false`（明确不参与）两种**可重建**的语义下记录；
 * `AbortController` 实例不持久化（用户的 ctrl，重发不能复用已 abort 的实例）。
 */
const INTENT_KEY = '_cancel_intent';


function $register(group: string, ctrl: AbortController): void {
    let set = groups.get(group);
    if (!set) groups.set(group, (set = new Set()));
    set.add(ctrl);
}

function $unregister(group: string, ctrl: AbortController): void {
    const set = groups.get(group);
    if (!set) return;
    set.delete(ctrl);
    if (set.size === 0) groups.delete(group);
}


/**
 * 取消请求插件 —— **全局共享**的请求登记表（跨所有 axios 实例），按 `aborter` 分组。
 *
 *   - `cancelAll()`         —— 清空所有分组（一次性清场）
 *   - `cancelAll('group')`  —— 仅清命名组（如登出时清 `auth` 组）
 *
 * `aborter` 字段（请求级）：
 *   - `false`             ⇒ 跳过，不接管也不登记
 *   - `true / null / undefined` ⇒ 默认组；用户已有 `signal` / `cancelToken` 时尊重不接管
 *   - `string`            ⇒ 命名组（强制接管 signal）
 *   - `AbortController`   ⇒ 用用户提供的 ctrl + 登记默认组
 *
 * settle（成功 / 失败 / 取消）⇒ 自动从分组集合移除（防内存泄漏）。
 *
 * @example
 *   ax.get('/list');                                    // 默认组
 *   cancelAll();                                        // 清空所有
 *
 *   ax.get('/me', undefined, { aborter: 'auth' });      // 命名组
 *   cancelAll('auth', 'logout');                        // 仅清 auth 组
 *
 *   const ctrl = new AbortController();
 *   ax.get('/big', undefined, { aborter: ctrl });       // 自管 ctrl + 登记默认组
 *   ctrl.abort();                                       // 手动中止；cancelAll() 也能命中
 *
 *   ax.get('/realtime', undefined, { aborter: false }); // 完全不参与
 */
export default function cancel({ enable = true }: ICancelOptions = {}): Plugin {
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`);
            if (!enable) return;

            ctx.request(function $cancel(config) {
                const c = config as unknown as Record<string, unknown>;
                let aborter = config.aborter;
                // 重发场景：原 aborter 已被首发消费删除；从 INTENT_KEY 重建意图
                if (aborter === undefined) {
                    const intent = c[INTENT_KEY];
                    if (intent === false || typeof intent === 'string') {
                        aborter = intent as ICancelOptions['aborter'];
                    }
                }
                delete config.aborter;

                if (aborter === false) {
                    c[INTENT_KEY] = false;
                    return config;
                }

                let ctrl: AbortController;
                let group = DEFAULT_GROUP;

                if (aborter instanceof AbortController) {
                    // 用户自管 ctrl —— 不持久化（重发不应复用已 abort 的实例）
                    ctrl = aborter;
                    config.signal = ctrl.signal;
                } else if (typeof aborter === 'string') {
                    ctrl = createAborter();
                    config.signal = ctrl.signal;
                    group = aborter;
                    c[INTENT_KEY] = aborter;   // 持久化命名组，跨重发恢复
                } else {
                    // true / null / undefined ⇒ 默认组；用户已有 signal 时尊重
                    if (config.signal || config.cancelToken) return config;
                    ctrl = createAborter();
                    config.signal = ctrl.signal;
                }

                $register(group, ctrl);
                c[CTRL_KEY] = ctrl;
                c[GROUP_KEY] = group;
                return config;
            });

            const release = (config: unknown): void => {
                if (!config || typeof config !== 'object') return;
                const c = config as Record<string, unknown>;
                const ctrl = c[CTRL_KEY] as AbortController | undefined;
                const group = c[GROUP_KEY] as string | undefined;
                if (!ctrl || !group) return;
                $unregister(group, ctrl);
                delete c[CTRL_KEY];
                delete c[GROUP_KEY];
            };

            ctx.response(
                (response) => { release(response.config); return response; },
                (error: unknown) => {
                    release((error as { config?: unknown } | null)?.config);
                    return Promise.reject(error);
                },
            );
        },
    };
}


/**
 * 中止活跃请求 —— 全局共享，跨所有 axios 实例。
 *   - 不传 `group` ⇒ 清空**所有分组**（默认组 + 命名组）
 *   - 传 `group`   ⇒ 仅清该命名组（默认组传 `'__default__'`）
 *
 * 不影响 `aborter:false` / 用户自带 signal / cancelToken 的请求 —— 它们没登记。
 *
 * @returns 实际被中止的请求数
 */
export function cancelAll(group?: string, reason?: string): number {
    if (group !== undefined) {
        const set = groups.get(group);
        if (!set || set.size === 0) return 0;
        const n = set.size;
        for (const ctrl of set) ctrl.abort(reason);
        set.clear();
        groups.delete(group);
        return n;
    }
    let n = 0;
    for (const set of groups.values()) {
        n += set.size;
        for (const ctrl of set) ctrl.abort(reason);
    }
    groups.clear();
    return n;
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(cancel)` 在 minify 后仍能识别
lockName(cancel, name);
