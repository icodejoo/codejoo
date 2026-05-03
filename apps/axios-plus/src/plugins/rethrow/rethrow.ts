
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Plugin } from '../../plugin/types';
import { __DEV__, requirePlugin , lockName} from '../../helper';
import ApiResponse from '../../objects/ApiResponse';
import type { IRethrowOptions, TRethrowTransform, TShouldRethrow } from './types';
import { name as normalizeName } from '../normalize';


export const name = 'rethrow';


/**
 * Rethrow 插件 —— 把 normalize 归一化后"统一 onFulfilled"的失败响应**重新 reject** 给业务 caller。
 *
 * **核心契约**：
 *   - `apiResp.success === true`  → 永远 resolve；rethrow **不做任何事**，不改变接口本身的行为
 *   - `apiResp.success === false` → 默认 reject（业务 caller 走 .catch 拿到 ApiResponse）
 *
 * 由于 normalize 把所有 settle 形态归一为 onFulfilled，业务 caller 用 `try/catch` 抓不到错误。
 * rethrow 只是恢复"失败走 .catch"的直观语义，**不会**因为 nullable / data 形态等理由 reject 成功响应。
 *
 * **必须**在所有依赖 normalize 的插件之后 use（**通常是最后一个**）：
 *   - normalize 把所有 settle 形态归一为 `response.data: ApiResponse` 后 resolve
 *   - retry / cache / share / loading / notification 都在 onFulfilled 上工作
 *   - rethrow 最后看到完全处理好的 ApiResponse，按 success 决定 resolve / reject
 *
 * **裁决规则**（仅在 `apiResp.success === false` 时有意义）：
 *   1. `config.rethrow === false` → 本次失败也 resolve（豁免）
 *   2. `opts.shouldRethrow(...)` 返回 `true` / `false` → 用它
 *   3. else → reject
 *
 * **reject 值** 默认是 `apiResp`；可通过 `opts.transform` 自定义。
 *
 * @example
 *   api.use([
 *     normalize(),
 *     retry(),
 *     notification({ ... }),
 *     rethrow({
 *       shouldRethrow: (apiResp) => apiResp.code === 'CANCEL' ? false : null,  // CANCEL 不 reject
 *     }),
 *   ]);
 *
 *   // 业务 caller：
 *   try {
 *     const res = await api.get('/x')();           // res.data: ApiResponse；res.data.data: 真业务数据
 *   } catch (apiResp) {                            // ← 失败走 .catch，拿到 ApiResponse
 *     toast(apiResp.message ?? '请求失败');
 *   }
 *
 *   // 单次让本次失败也 resolve（如非关键探活）：
 *   api.get('/heartbeat', { rethrow: false });
 */
export default function rethrow({
    enable = true,
    shouldRethrow,
    transform,
}: IRethrowOptions = {}): Plugin {
    const opts: IResolvedRethrow = { enable, shouldRethrow, transform };
    return {
        name,
        install(ctx) {
            requirePlugin(ctx, normalizeName);
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`);
            if (!enable) return;

            ctx.response((response: AxiosResponse) => {
                const apiResp = response.data;
                if (!(apiResp instanceof ApiResponse)) return response;     // 非归一化形态直接放行

                if ($shouldReject(apiResp, response, response.config, opts)) {
                    const rejectValue = opts.transform
                        ? opts.transform(apiResp, response)
                        : apiResp;
                    return Promise.reject(rejectValue);
                }
                return response;
            });
        },
    };
}


/** @internal */
export interface IResolvedRethrow {
    enable: boolean;
    shouldRethrow?: TShouldRethrow;
    transform?: TRethrowTransform;
}


/**
 * 完整裁决逻辑。返回 `true` 表示要 reject。
 *
 * 契约：`apiResp.success === true` 永远 resolve，**任何配置都不能让成功响应 reject**。
 * 所有可配置项只影响"失败响应是否 reject"。
 *
 * @internal exported for unit tests
 */
export function $shouldReject(
    apiResp: ApiResponse,
    response: AxiosResponse,
    config: AxiosRequestConfig,
    opts: IResolvedRethrow,
): boolean {
    // 0. 核心契约：success === true 永远 resolve（不改变接口本身行为）
    if (apiResp.success) return false;

    // 以下分支仅在 success === false 时执行：

    // 1. 请求级豁免：rethrow:false → 本次失败也 resolve
    const reqRethrow = $unwrap(config?.rethrow, config);
    if (reqRethrow === false) return false;

    // 2. 自定义裁决（仅在 success === false 时被调用）
    if (opts.shouldRethrow) {
        const r = opts.shouldRethrow(apiResp, response, config);
        if (r === true) return true;
        if (r === false) return false;
        // null / undefined / void → 走默认
    }

    // 3. 默认：失败 reject
    return true;
}


/** 解开 MaybeFun（函数形态以 config 为入参）@internal */
function $unwrap(v: unknown, config: AxiosRequestConfig | undefined): unknown {
    if (typeof v !== 'function' || !config) return v;
    return (v as (c: AxiosRequestConfig) => unknown)(config);
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(rethrow)` 在 minify 后仍能识别
lockName(rethrow, name);
