/**
 * Svelte 适配层：`skeleton` action，按 loading 自动开关骨架。
 * 前提：入口处导入一次 `skeletonizer`（完整版）或 `skeletonizer/lite`（只导入一个，样式随之自带）；适配层不含 core，通过私有全局键取实现，未导入时开发模式报错。
 * text / engine 等完整版选项只有导入完整版后才有类型与效果。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 */
// 类型来自 skeletonizer/lite（导入完整版后自动变宽）；运行时只经 adapter-api 取全局 API，不含 core 代码
import type { EnableOptions, SkzBareAttr, SkzHtmlAttributesFor } from "skeletonizer/lite";
import { disable, toggle } from "./adapter-api.js";

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

/**
 * 让模板里的 skz-* 属性有补全与取值检查：把 SkzHtmlAttributes 并入 svelte/elements 的 HTMLAttributes（导入本适配层即生效）。
 * 裸写法 `<img skz-bone>` 在 Svelte 里是 `true`，所以裸属性类型多收一个 true。
 * 注意：svelte 不是本包依赖，用户没装 svelte 时这段增强指向找不到的模块，只在没开 skipLibCheck 时报 TS2664。
 */
// @ts-ignore -- svelte 不是本包依赖，源码构建时解析不到它；使用方装了 svelte 就能解析
declare module "svelte/elements" {
  interface HTMLAttributes<T extends EventTarget> extends SkzHtmlAttributesFor<SkzBareAttr | true> {}
}
