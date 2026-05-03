import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { MaybeFunc } from '../../helper';
import type ApiResponse from '../../objects/ApiResponse';


/**
 * 唯一裁决钩子 —— 优先级最高，覆盖 `methods` / `status` / `code` 等所有默认规则。
 *
 *   - **入参**：归一化后的 `apiResp` —— 整条链路统一成功/失败/网络/超时/cancel 都在这里
 *   - **返回值语义**：
 *       - `true`  → 强制重试
 *       - `false` → 强制不重试
 *       - `null` / `undefined` / `void` → 走默认规则
 */
export type TShouldRetry = (
    apiResp: ApiResponse,
    response: AxiosResponse,
) => boolean | null | void;


export interface IRetryHookCtx {
    /** 归一化后的失败响应 */
    apiResp: ApiResponse;
    /** 原始 response（含 status / config） */
    response: AxiosResponse;
    /** 当前请求 config —— 已挂上 `__retry` 计数 */
    request: AxiosRequestConfig;
    /** 即将进行的重试编号（1-based） */
    retryCount: number;
}


/** 重试前钩子；返回 `false` 取消本次重试 */
export type TBeforeRetry = (ctx: IRetryHookCtx) => unknown | Promise<unknown>;


export interface IRetryOptions {
    /** 总开关；默认 `true` */
    enable?: boolean;

    /**
     * 最大重试次数：
     *   - `false` / `0`             → 不重试
     *   - `true` / `undefined`       → 默认次数（2）
     *   - `number > 0`               → 显式上限
     *   - `-1`                       → 无限重试（请配合 `shouldRetry` 限流）
     */
    max?: number | boolean;

    /**
     * 触发重试的 HTTP 方法白名单。**与默认 `['get','put','head','delete','options','trace']` 合并**。
     * POST/PATCH 默认排除（非幂等）；需要重试时显式列出。
     */
    methods?: string[];

    /**
     * 触发重试的状态码白名单。**与默认 `[408,413,429,500,502,503,504]` 合并**。
     * 命中且响应带 `Retry-After` / `RateLimit-*` 头时，优先用头里的延迟。
     */
    status?: number[];

    /**
     * 触发重试的归一化 code 白名单。**与默认 `['NETWORK_ERR','TIMEOUT_ERR','HTTP_ERR']` 合并**。
     * `'CANCEL'` 永远不会被重试（用户主动取消）。
     */
    codes?: string[];

    /**
     * 基础延迟（ms 或 `(attempt) => ms`）。默认指数退避：`0.3 * 2^(attempt-1) * 1000`。
     */
    delay?: number | ((attempt: number) => number);
    /** 单次延迟上限 @default Infinity */
    delayMax?: number | ((attempt: number) => number);
    /** Retry-After 头延迟上限（ms）@default Infinity */
    retryAfterMax?: number;
    /** 抖动：`true` 在 `[0, delay)` 随机；或 `(delay) => ms` 自定义 */
    jitter?: boolean | ((delay: number) => number);
    /** 超时是否重试 @default false */
    retryOnTimeout?: boolean;

    /**
     * 唯一裁决钩子；优先级最高。返回 true/false 强制；返回 null/undefined 走默认规则。
     */
    shouldRetry?: TShouldRetry;

    /** 重试前钩子；返回 `false` 取消本次重试 */
    beforeRetry?: TBeforeRetry;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 失败重试配置：
         *   - `false` / `0`         → 强制禁用本请求
         *   - `true`                → 走插件级默认
         *   - `number`              → 覆盖最大次数（-1 = 无限）
         *   - `IRetryOptions` 对象   → 字段级覆盖（methods / status / codes 与插件级合并）
         *   - 函数                   → MaybeFun
         */
        retry?: MaybeFunc<number | boolean | IRetryOptions>;
    }
}
