
import type { Plugin } from '../../plugin/types';
import { __DEV__ , lockName} from '../../helper';
import type { AxiosAdapter } from 'axios';
import type { ILoadingOptions, TLoadingFunc } from './types';


export const name = 'loading';


/**
 * 在请求生命周期内自动调用 `loading(true)` / `loading(false)` 控制加载提示。
 *
 *   - **三条路径**：
 *       1. **跳过**：`config.loading === false` 或 (未指定 + `default:false`) ⇒ 直接放行
 *       2. **独立执行**：`config.loading` 是函数 ⇒ 立即 `fn(true)`、settle 后 `fn(false)`，
 *          不参与全局计数 / delay / mdt
 *       3. **全局计数**：`config.loading === true` 或 (未指定 + `default:true`) ⇒ 多请求共用
 *          `count`，`delay` 滤快请求、`mdt` 给慢请求兜底
 *   - **插件级 `enable: false`** kill switch
 */
export default function loading({
    enable = true,
    loading,
    delay = 0,
    mdt = 500,
    default: defaultEnabled = false,
}: ILoadingOptions = {}): Plugin {
    return {
        name,
        install(ctx) {
            if (__DEV__)
                ctx.logger.log(
                    `${name} enabled:${enable} default:${defaultEnabled} ` +
                        `hasCallback:${!!loading} delay:${delay}ms mdt:${mdt}ms`,
                );
            if (!enable) return;
            const prev = ctx.axios.defaults.adapter as AxiosAdapter;
            ctx.adapter($wrap(prev, loading, delay, mdt, defaultEnabled));
        },
    };
}


/**
 * 构造包装后的 adapter —— **单 timer 变量 + `shown` 作状态判别**：
 *
 *   - `shown=true`  ⇒ spinner 当前可见；`shownAt` 是首次 `cb(true)` 的时间戳
 *   - `shown=false` ⇒ 不可见；`timer` 若指向某 ID 则是"等延迟显示"，否则纯 idle
 *   - `clearTimeout` 对已 fire / 已 cancel 的 ID 是 no-op，因此**不需要 `timer = null`**
 *
 * **状态机**：
 *   ```
 *   idle ──(0→1, delay)──→ show-pending ──(timer fire)──→ showing
 *    ▲                       │                              │
 *    │                       └──(1→0)──→ idle (cancel)      │
 *    │                                                       │
 *    │  ┌──(1→0, mdt 已满)──→ idle ←──(timer fire)──┐       │
 *    │  │                                            │       │
 *    └─ showing ──(1→0, mdt 不足)──→ hide-pending ───┘       │
 *                  ▲                  │                       │
 *                  │                  └──(0→1)──→ showing (cancel hide)
 *                  └──────────────────────────────┘
 *   ```
 *
 *   - cancel hide 不重置 `shownAt` ⇒ 视觉连续，mdt 计时不"累加"
 *   - settle 时 `remaining = mdt - elapsed`，elapsed ≥ mdt ⇒ 立即 hide（**不会再延迟**）
 *
 * @internal exported for unit tests
 */
export function $wrap(
    prev: AxiosAdapter,
    cb: TLoadingFunc | undefined,
    delay: number,
    mdt: number,
    defaultEnabled: boolean,
): AxiosAdapter {
    const useDelay = delay > 0;
    const useMdt = mdt > 0;
    let count = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    let shownAt = 0;
    const show = () => {
        shown = true;
        if (useMdt) shownAt = Date.now();
        cb!(true);
    };
    const hide = () => {
        shown = false;
        cb!(false);
    };
    return (config) => {
        const v = config.loading;
        delete config.loading;

        // 私有路径：函数 ⇒ 独立执行
        if (typeof v === 'function') {
            v(true);
            return prev(config).finally(() => v(false));
        }

        // 全局路径准入
        if (!(v === true || (v == null && defaultEnabled))) return prev(config);
        if (!cb) return prev(config);

        if (++count === 1) {
            if (shown) clearTimeout(timer);                       // 取消 hide-pending
            else if (useDelay) timer = setTimeout(show, delay);    // 安排 delay 后显示
            else show();                                           // 立即显示
        }
        return prev(config).finally(() => {
            if (--count !== 0) return;
            if (!shown) return clearTimeout(timer);               // 取消 show-pending（含 stale ID，无害）
            const remaining = useMdt ? mdt - (Date.now() - shownAt) : 0;
            if (remaining > 0) timer = setTimeout(hide, remaining); // 等够 mdt 再 hide
            else hide();                                           // 已满 mdt，立即 hide
        });
    };
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(loading)` 在 minify 后仍能识别
lockName(loading, name);
