import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { MaybeFunc } from '../../helper';
import type ApiResponse from '../../objects/ApiResponse';


/**
 * 自定义裁决回调（仅在 `apiResp.success === false` 路径上有意义；
 * success===true 永远 resolve，不会调用此钩子）。
 *   - 返回 `true`  → reject
 *   - 返回 `false` → 本次失败也 resolve（豁免）
 *   - 返回 `null` / `undefined` / `void` → 走默认（reject）
 */
export type TShouldRethrow = (
    apiResp: ApiResponse,
    response: AxiosResponse,
    config: AxiosRequestConfig,
) => boolean | null | undefined | void;


/** rethrow 拒绝时构造最终 reject 值的 transform。默认直接 reject `apiResp`。 */
export type TRethrowTransform = (apiResp: ApiResponse, response: AxiosResponse) => unknown;


/**
 * 插件级选项。
 *
 * **核心契约**：rethrow 仅在 `apiResp.success === false` 路径上把 Promise 改成 reject；
 * 对 `apiResp.success === true` 的响应**完全无操作**，不会改变接口本身的行为。
 */
export interface IRethrowOptions {
    /** 总开关；默认 `true`。设为 `false` 时整个插件不安装 */
    enable?: boolean;

    /**
     * 自定义裁决；仅在 `apiResp.success === false` 时调用。
     *   - 返回 `false` → 让本次失败也 resolve（如把 CANCEL 排除掉，业务侧不当错处理）
     *   - 返回 `true`  / `null` / `undefined` → 走默认 reject
     */
    shouldRethrow?: TShouldRethrow;

    /**
     * 拒绝时构造最终 reject 值的 transform。默认直接 reject `apiResp`。
     * 用于业务想 reject 一个自定义错误类的场景：`(apiResp) => new HttpError(apiResp)`。
     */
    transform?: TRethrowTransform;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 请求级豁免。仅在 `apiResp.success === false` 路径有意义：
         *   - `false`           → 本次失败也 resolve（豁免本次 reject）
         *   - 函数 `(c) => false` → MaybeFun 形式的同上
         *   - `true` / 未指定    → 走默认（失败 reject）
         *
         * **不**支持"强制 reject success=true 响应"——此插件契约保证不改变成功行为。
         */
        rethrow?: MaybeFunc<boolean | null | undefined | void>;
    }
}
