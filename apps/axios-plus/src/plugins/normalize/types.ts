import type { AxiosError, AxiosResponse } from 'axios';
import type ApiResponse from '../../objects/ApiResponse';


/**
 * 业务码字段定位 —— 与 notification 的 `code` 选项保持同义。
 *   - **字符串路径**（相对 `response.data` 的 `.` 路径）：`'code'` / `'0'` / `'error.code'`
 *   - **函数形态**：完全自定义，从 response / error 任一/二者抠出 lookup key
 */
export type TBizField =
    | string
    | ((response: AxiosResponse | undefined, error: AxiosError | undefined) => unknown);


/** normalize 解析后送给 ApiResponse 的 envelope 三元组 */
export interface IBizTriple {
    code: unknown;
    message: unknown;
    data: unknown;
}


/**
 * 成功判定函数 —— 入参是已经组装好的 `ApiResponse`（`.success` 暂为 false），
 * 返回 boolean 决定最终 `apiResp.success`。
 *
 * 这是 normalize 唯一的"成功裁决"入口；不再支持标量 / 数组形态。
 *
 * @example
 *   normalizePlugin({
 *     success: (apiResp) => apiResp.code === '0000',
 *   });
 */
export type TSuccess = (apiResp: ApiResponse) => boolean;


/** 插件级选项 */
export interface INormalizeOptions {
    /**
     * 业务码字段定位（字符串路径相对 `response.data` 解析）
     * @default 'code'
     */
    codeKeyPath?: TBizField;

    /**
     * 业务消息字段定位（字符串路径相对 `response.data` 解析）
     * @default 'message'
     */
    messageKeyPath?: TBizField;

    /**
     * 业务数据字段定位（字符串路径相对 `response.data` 解析）
     * @default 'data'
     */
    dataKeyPath?: TBizField;

    /**
     * **必传** —— 接收已组装好（`.success=false`）的 `ApiResponse`，返回 boolean 决定最终成功状态。
     * 由用户根据自家 envelope 约定实现，比如：
     *
     *     success: (apiResp) => apiResp.code === '0000'
     */
    success: TSuccess;

    /** HTTP 4xx/5xx 但服务端没给 envelope 时的占位 code @default 'HTTP_ERR' */
    httpErrorCode?: string;
    /** 网络错误占位 code @default 'NETWORK_ERR' */
    networkErrorCode?: string;
    /** 超时错误占位 code @default 'TIMEOUT_ERR' */
    timeoutErrorCode?: string;
    /** 用户取消占位 code @default 'CANCEL' */
    cancelCode?: string;
}


/** 请求级 normalize 配置（与插件级浅合并；额外允许只传 `success`） */
export type INormalizeRequestOptions =
    & Partial<Omit<INormalizeOptions, 'success'>>
    & {
        /**
         * **可选** —— 单次请求覆盖成功判定函数。
         * 如本字段提供，则**完全裁决本次请求的 success**：插件级 success / 请求级
         * `nullable` / `emptyable` 都不参与。
         */
        success?: TSuccess;
    };


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 请求级 normalize 配置：
         *   - `false` → 跳过本请求（拿到原始 axios response，业务自行处理）
         *   - 对象   → 与插件级浅合并（仅本请求覆盖）
         */
        normalize?: false | INormalizeRequestOptions;

        /**
         * 单次允许 `apiResp.data` 为 `null` / `undefined`：
         *   - `true`  ⇒ data=null/undefined 也视为成功（即便插件级 success 函数返回 false）
         *   - `false` ⇒ data=null/undefined 视为失败（即便插件级 success 函数返回 true）
         *   - 未指定  ⇒ 不参与决策
         *
         * **注意**：仅当请求级**未提供** `success` 函数时生效；提供 success 时由该函数全权裁决。
         */
        nullable?: boolean;

        /**
         * 单次允许 `apiResp.data` 为空容器（`{}` / `[]` / `''`）。
         * 同 `nullable` 的语义对偶 —— 仅当请求级未提供 `success` 时生效。
         */
        emptyable?: boolean;
    }
}
