
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Plugin } from '../../plugin/types';
import { __DEV__, requirePlugin , lockName} from '../../helper';
import ApiResponse from '../../objects/ApiResponse';
import { name as normalizeName } from '../normalize';
import type {
    INotificationMessages,
    INotificationOptions,
    INotifyHookCtx,
    INotifyResolveCtx,
    TNotifyFn,
    TNotifyMessage,
} from './types';


export const name = 'notification';


/**
 * 跨 retry-level 去重标记。retry 重入完整链路时会让 notification 在每一层都跑一次 ——
 * 用 Symbol 在 settle 值上打标做幂等保护。
 */
const NOTIFIED = Symbol('http-plugins:notification:notified');


/**
 * 请求结果通知插件 —— 把"出错怎么提示用户"集中收口。
 *
 * **必须在 `normalize` 之后 use**（normalize 把所有形态归一为 `response.data: ApiResponse`，
 * notification 直接读这一个形态，不再做 shape detection）。
 *
 *   - **触发条件**：`response.data instanceof ApiResponse && !apiResp.success`
 *   - **消息来源优先级**：
 *       1. `config.notify` 请求级覆盖（null/空白 → 跳；非空字符串 → 直接用；undefined/void → 走表）
 *       2. `messages[apiResp.code]`     业务码 / 占位码（HTTP_ERR / NETWORK_ERR / TIMEOUT_ERR / CANCEL）
 *       3. `messages[apiResp.status]`   HTTP 状态码
 *       4. `messages.default`           兜底
 *   - **`notify` 回调异常被吞**：通知失败不破坏后续插件链
 *   - **不阻塞 settle 传播**：notify 不会被 await
 *   - **跨 retry 去重**：每层 settle 值带 NOTIFIED 标记，仅最里层那次触发
 *
 * @example
 *   api.use([
 *     normalize(),                                       // 1st，提供 ApiResponse
 *     retry({ max: 2 }),
 *     notification({                                     // 2nd...
 *       notify: (msg) => toast.error(msg),
 *       messages: {
 *         BIZ_ERR: (apiResp) => apiResp.message ?? '业务异常',
 *         HTTP_ERR: '服务器错误',
 *         NETWORK_ERR: '网络异常',
 *         TIMEOUT_ERR: '请求超时',
 *         CANCEL: null,                                  // 用户取消不通知（注：null 在表里也是有效值）
 *         500: '服务器错误',
 *         default: '请求失败',
 *       },
 *     }),
 *     // ... 其他插件
 *     rethrow(),                                         // last
 *   ]);
 *
 *   // 单次静默：
 *   api.get('/heartbeat', { notify: null });
 *   // 单次直接给字符串：
 *   api.post('/login', body, { notify: '登录失败' });
 */
export default function notification({
    enable = true,
    notify,
    messages = {},
}: INotificationOptions = {}): Plugin {
    return {
        name,
        install(ctx) {
            requirePlugin(ctx, normalizeName);
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable} hasNotify:${!!notify}`);
            if (!enable) return;

            ctx.response((response: AxiosResponse) => {
                const apiResp = response.data;
                if (!(apiResp instanceof ApiResponse)) return response;     // 非归一化形态（用户自己关了 transform） → 跳过
                if (apiResp.success) return response;                     // 成功不通知
                if ($wasNotified(response)) return response;                 // 跨 retry 去重

                const action = $resolve(response.config, apiResp, response, messages, notify);
                if (action) {
                    $markNotified(response);
                    $safeFire(ctx, action.notify, action.message, { apiResp, response, config: response.config });
                }
                return response;
            });
        },
    };
}


// ───────────────────────────────────────────────────────────────────────────
//  settle 值标记 + 去重 + 安全触发
// ───────────────────────────────────────────────────────────────────────────

function $wasNotified(value: unknown): boolean {
    return value != null && typeof value === 'object' && (value as any)[NOTIFIED] === true;
}

function $markNotified(value: unknown): void {
    if (value == null || typeof value !== 'object') return;
    try { (value as any)[NOTIFIED] = true; } catch { /* 冻结 → 至多多通知一次 */ }
}

function $safeFire(
    ctx: { logger: { error: (...a: unknown[]) => void } },
    notify: TNotifyFn,
    message: string,
    hookCtx: INotifyHookCtx,
): void {
    try { notify(message, hookCtx); }
    catch (e) { if (__DEV__) ctx.logger.error('notify callback threw', e); }
}


// ───────────────────────────────────────────────────────────────────────────
//  解析"用哪个消息 + 用哪个 notify"
// ───────────────────────────────────────────────────────────────────────────

/**
 * 单一路径解析：config.notify → 表查找。
 * @internal exported for unit tests
 */
export function $resolve(
    config: AxiosRequestConfig | undefined,
    apiResp: ApiResponse,
    response: AxiosResponse,
    messages: INotificationMessages,
    notifyFn: TNotifyFn | undefined,
): { message: string; notify: TNotifyFn } | null {
    if (!notifyFn) return null;

    const lookup = () => $lookup(apiResp, response, messages);
    const resolved = $unwrap(config, apiResp, response, messages, lookup);

    if (resolved === null) return null;
    if (typeof resolved === 'string') {
        const trimmed = resolved.trim();
        return trimmed ? { message: trimmed, notify: notifyFn } : null;
    }
    // undefined / void → 走表
    const message = lookup();
    return message ? { message, notify: notifyFn } : null;
}


/** 解开 config.notify 的 MaybeFun。函数形态以 INotifyResolveCtx 调用 @internal */
function $unwrap(
    config: AxiosRequestConfig | undefined,
    apiResp: ApiResponse,
    response: AxiosResponse,
    messages: INotificationMessages,
    lookup: () => string | null,
): unknown {
    const v = config?.notify;
    if (typeof v !== 'function') return v;
    const ctx: INotifyResolveCtx = {
        apiResp, response, config: config!, messages, lookup,
    };
    return (v as (c: INotifyResolveCtx) => unknown)(ctx);
}


/**
 * 表查找：apiResp.code → apiResp.status → default。
 * @internal exported for unit tests
 */
export function $lookup(
    apiResp: ApiResponse,
    response: AxiosResponse,
    messages: INotificationMessages,
): string | null {
    // 1. 业务码 / 占位码（最具体）
    if (apiResp.code != null) {
        const hit = messages[String(apiResp.code)];
        if (hit !== undefined) return $callOrReturn(hit, apiResp, response);
    }
    // 2. HTTP 状态码
    if (apiResp.status != null && apiResp.status !== 0) {
        const hit = messages[String(apiResp.status)];
        if (hit !== undefined) return $callOrReturn(hit, apiResp, response);
    }
    // 3. 兜底
    if (messages.default !== undefined) return $callOrReturn(messages.default, apiResp, response);
    return null;
}


/** 把 string / function 统一成 string；空串/null/void → null @internal */
function $callOrReturn(
    msg: TNotifyMessage,
    apiResp: ApiResponse,
    response: AxiosResponse,
): string | null {
    if (typeof msg === 'string') return msg || null;
    if (typeof msg === 'function') {
        const out = msg(apiResp, response);
        return typeof out === 'string' && out ? out : null;
    }
    return null;
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(notification)` 在 minify 后仍能识别
lockName(notification, name);
