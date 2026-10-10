/**
 * Svelte 适配层：`skeleton` action，按 loading 自动开关骨架。
 * 前提：入口处引入一次样式（`skeletonizer` 默认带 core.css，或 `skeletonizer/explicit`）；text / engine / sweep 等完整版能力再引入 `skeletonizer/full` 或 `/global`、`/svg`、`/all`。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 */
// 直接引用 core 模块（不经过 core 入口）：不带 core.css，也不挂全局 skz
import { disable, toggle } from "./core/enable.js";
import type { EnableOptions } from "./core/types.js";

/** skeleton action 的参数 */
export interface SkzParams extends EnableOptions {
  /** 是否加载中 */
  loading: boolean;
}

/**
 * Svelte action：`<div use:skeleton={{ loading, effect: 'pulse' }}>`。
 * @param node 目标元素（Svelte 自动传入）
 * @param params 参数
 * @returns action 生命周期：update / destroy
 * @example
 * <div use:skeleton={{ loading }}><UserCard {user} /></div>
 */
export function skeleton(node: HTMLElement, params: SkzParams) {
  toggle(node, params.loading, params);
  return {
    update: (next: SkzParams): void => toggle(node, next.loading, next),
    destroy: (): void => disable(node),
  };
}
