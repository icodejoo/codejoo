/**
 * 拒绝裁决插件 —— 把归一化后的 onFulfilled 结果按规则重新 reject 给业务 caller。
 *
 * 必须在所有依赖 normalize 的插件之后 use（通常是最后一个）。
 *
 * 详细说明、裁决规则与示例见 ./rethrow.ts 的 JSDoc。
 */

export { default , name } from './rethrow';
export type {
    IRethrowOptions,
    TShouldRethrow,
    TRethrowTransform,
} from './types';
