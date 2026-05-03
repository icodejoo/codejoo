/**
 * 请求结果通知插件 —— 把"出错怎么提示用户"集中收口。
 *
 * 必须在 `normalize` 之后 use（依赖 ApiResponse 形态）。
 *
 * 详细说明、消息来源优先级、配置项见 ./notification.ts 的 JSDoc。
 */

export { default , name } from './notification';
export type {
    INotificationOptions,
    INotificationMessages,
    INotifyHookCtx,
    INotifyResolveCtx,
    TNotifyFn,
    TNotifyMessage,
} from './types';
