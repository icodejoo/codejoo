import { disable, toggle } from "./enable.js";
import type { EnableOptions } from "./enable.js";

/** skeleton action 的参数 */
export interface SkzParams extends EnableOptions {
  /** 是否加载中 */
  loading: boolean;
}

/**
 * Svelte action：`<div use:skeleton={{ loading, effect: 'pulse' }}>`。
 * 前提：入口处引入一次基底样式（`skeletonizer/base.css` 或 `explicit.css`），pulse / shimmer 再引入 `skeletonizer/global` 或 `/svg`（或一次引入 `skeletonizer/all`）。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
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
