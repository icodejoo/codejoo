/**
 * 鉴权插件 —— 受保护请求路由 → refresh / replay / deny / expired / others。
 *
 * 必须在 `normalize` 之后 use（依赖 ApiResponse 形态）。
 *
 * 详细说明、裁决规则与示例见 ./auth.ts 的 JSDoc。
 */

export { default, name } from './auth';
export type {
    IAuthOptions,
    TAuthFunc,
} from './types';
