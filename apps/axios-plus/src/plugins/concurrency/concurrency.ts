import type { Plugin } from '../../plugin/types';
import {Type,  __DEV__ , lockName} from '../../helper';
import type { AxiosAdapter } from 'axios';
import type { IConcurrencyOptions } from './types';


export const name = 'concurrency';


/**
 * 并发控制插件 —— 限制 axios 实例的最高在飞请求数。
 *
 *   - **adapter 包装**：超过 `max` 的请求进入 FIFO 队列；前一个 settle（成功 / 失败）
 *     释放槽位后自动唤醒队首
 *   - **`max <= 0` ⇒ 不限制**：仍装载 adapter（清理 `config.concurrency` 字段），
 *     但走轻量直通分支，不分配 Promise / 不维护队列
 *   - **method 白名单**：不在 `methods` 内的请求直接放行，不计入并发
 *   - **请求级 bypass**：`config.concurrency = false` 直接跳过队列
 *   - **abort 友好**：在队列中的请求若 `signal.aborted`，自动从队列移除并 reject，
 *     避免占用未来的槽位
 *
 * @example
 *   api.use(concurrency({ max: 4 }));
 *   // 同一 axios 实例最多 4 个 HTTP 在飞，超出的进入 FIFO 队列
 *
 *   ax.get('/big', { concurrency: false });  // 强行跳过队列
 */
export default function concurrency({
    enable = true,
    max = 999,
    methods = '*',
}: IConcurrencyOptions = {}): Plugin {
    const allowedMethods =
        Type.isArray(methods) && methods.length && !methods.includes('*')
            ? new Set(methods.map((m) => m.toLowerCase()))
            : null;
    return {
        name,
        install(ctx) {
            if (__DEV__) {
                ctx.logger.log(
                    `${name} enable:${enable} max:${max <= 0 ? '∞' : max} ` +
                    `methods:${allowedMethods ? [...allowedMethods].join(',') : '*'}`,
                );
            }
            if (!enable) return;

            const prev = ctx.axios.defaults.adapter as AxiosAdapter;

            // max <= 0 ⇒ 不限制：装个轻量直通 adapter 仅清理请求级字段
            if (max <= 0) {
                ctx.adapter((config) => {
                    delete config.concurrency;
                    delete config.priority;
                    return prev(config);
                });
                return;
            }

            let active = 0;
            /** 优先级队列 —— 按 `priority` 降序排列，同优先级保持 FIFO */
            const queue: Array<{ resolve: () => void; priority: number }> = [];

            /** 释放一个槽位；有等待者则唤醒队首（最高优先级 + 先入队）占用同一槽位 */
            const release = () => {
                const next = queue.shift();
                if (next) next.resolve();   // active 不动 —— 队首接手前任的槽位
                else active--;
            };

            /**
             * 申请一个槽位。
             *   - 有空闲 ⇒ 立即 active++ 并 resolve（priority 此时不参与）
             *   - 无空闲 ⇒ 按 priority 降序插入队列；release 时由队首唤醒
             *   - signal 已 aborted / 入队后 abort ⇒ 从队列移除并 reject
             */
            const acquire = (
                signal?: AbortSignal | null,
                priority = 0,
            ): Promise<void> =>
                new Promise<void>((resolve, reject) => {
                    if (signal?.aborted) {
                        reject(signal.reason);
                        return;
                    }
                    if (active < max) {
                        active++;
                        resolve();
                        return;
                    }
                    const item = { resolve, priority };
                    // 降序插入（同优先级 FIFO）：跳过所有 >= priority 的，落在它们之后
                    let i = 0;
                    while (i < queue.length && queue[i].priority >= priority) i++;
                    queue.splice(i, 0, item);
                    signal?.addEventListener(
                        'abort',
                        () => {
                            const idx = queue.indexOf(item);
                            if (idx >= 0) {
                                queue.splice(idx, 1);
                                reject(signal.reason);
                            }
                            // 已被 release 唤醒 ⇒ 队列里没了，promise 已 resolve，
                            // 此处 reject 自动 no-op（promise 只能 settle 一次）
                        },
                        { once: true },
                    );
                });

            ctx.adapter(async (config) => {
                const bypass = config.concurrency === false;
                const priority = config.priority ?? 0;
                delete config.concurrency;
                delete config.priority;
                if (bypass) return prev(config);
                if (
                    allowedMethods &&
                    !allowedMethods.has((config.method || 'get').toLowerCase())
                ) {
                    return prev(config);
                }
                await acquire(
                    config.signal as AbortSignal | null | undefined,
                    priority,
                );
                try {
                    return await prev(config);
                } finally {
                    release();
                }
            });

            ctx.cleanup(() => {
                queue.length = 0;
                active = 0;
            });
        },
    };
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(concurrency)` 在 minify 后仍能识别
lockName(concurrency, name);
