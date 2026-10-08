import { enable, disable } from "./enable.js";
import type { EnableOptions } from "./enable.js";

/** skeleton action 的参数 */
export interface XSkeParams extends EnableOptions {
  /** 是否加载中 */
  loading: boolean;
}

/**
 * 按参数同步元素的骨架态。
 * @param node 目标元素
 * @param params action 参数
 */
function apply(node: HTMLElement, params: XSkeParams): void {
  if (params.loading) enable(node, params);
  else disable(node);
}

/**
 * Svelte action：`<div use:skeleton={{ loading, effect: 'pulse' }}>`。
 * @param node 目标元素（Svelte 自动传入）
 * @param params 参数
 * @returns action 生命周期：update / destroy
 * @example
 * <div use:skeleton={{ loading }}><UserCard {user} /></div>
 */
export function skeleton(node: HTMLElement, params: XSkeParams) {
  apply(node, params);
  return {
    update: (next: XSkeParams): void => apply(node, next),
    destroy: (): void => disable(node),
  };
}
