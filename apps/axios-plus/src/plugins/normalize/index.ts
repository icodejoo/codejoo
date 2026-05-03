/**
 * 归一化插件 —— 把 axios 的多种 settle 形态（成功 / HTTP 错误 / 网络 / 超时 / cancel）
 * 统一成一种 onFulfilled 形态。下游插件不再需要处理 onRejected。
 *
 * 详细说明、配置项与示例见 ./normalize.ts 的 JSDoc。
 */

export { default, NETWORK_ERR_CODE , name } from './normalize';
export type {
    INormalizeOptions,
    IBizTriple,
    TBizField,
    TSuccess,
} from './types';
