import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { MaybeFunc as MaybeFunc } from '../../helper';
import type ApiResponse from '../../objects/ApiResponse';


/** 单条消息 —— 静态字符串或基于 ApiResponse 的动态函数 */
export type TNotifyMessage =
    | string
    | ((apiResp: ApiResponse, response: AxiosResponse) => string | null | undefined | void);


/**
 * code / status → 消息 的查找表，`default` 为兜底。
 *   - 数字字面量 key（404、500、`apiResp.status`…）会被 JS 自动转字符串
 *   - 字符串 key：业务码（'BIZ_ERR'、'0001'…）/ 错误占位码（'NETWORK_ERR' / 'TIMEOUT_ERR' / 'CANCEL' / 'HTTP_ERR'）
 *   - `default`：以上 key 都没匹配时使用
 */
export interface INotificationMessages {
    [statusOrCode: string]: TNotifyMessage | undefined;
    /** 兜底消息 */
    default?: TNotifyMessage;
}


/** notify 回调收到的上下文 */
export interface INotifyHookCtx {
    apiResp: ApiResponse;
    response: AxiosResponse;
    config: AxiosRequestConfig;
}


/**
 * 请求级 `config.notify` 的 MaybeFun 解包参数。
 *
 * @example
 *   config.notify = ({ apiResp, lookup }) => {
 *       if (apiResp.code === 'CRITICAL') return '紧急错误！';
 *       return lookup();           // 委托给插件级 messages 表
 *   };
 */
export interface INotifyResolveCtx {
    /** 已归一化的 ApiResponse */
    apiResp: ApiResponse;
    /** 原始 response（含 status / config 等） */
    response: AxiosResponse;
    /** 请求 config */
    config: AxiosRequestConfig;
    /** 插件级 messages 表（按引用暴露，请勿原地修改） */
    readonly messages: INotificationMessages;
    /** 走默认查找逻辑（apiResp.code → apiResp.status → default）返回字符串 */
    lookup(): string | null;
}


/** 通知器回调；收到解析后的消息字符串。返回值忽略；抛异常会被插件吞掉。 */
export type TNotifyFn = (message: string, ctx: INotifyHookCtx) => unknown;


/** 插件级选项 */
export interface INotificationOptions {
    /** 总开关；默认 `true` */
    enable?: boolean;
    /** 通知器回调（toast / alert / console …）；插件级缺省 */
    notify?: TNotifyFn;
    /** code / status → 消息 的查找表 */
    messages?: INotificationMessages;
}


declare module 'axios' {
    interface AxiosRequestConfig {
        /**
         * 请求级通知配置：
         *   - `null` / 空白字符串 → 跳过本请求
         *   - 非空字符串            → 直接以此字符串作为消息（**绕过** messages 查找表）
         *   - `undefined` / 函数返回 `void` → 走默认流程
         *   - 函数 `(ctx) => ...` → MaybeFun，用 INotifyResolveCtx 解开
         */
        notify?: MaybeFunc<string | null | undefined | void, INotifyResolveCtx>;
    }
}
