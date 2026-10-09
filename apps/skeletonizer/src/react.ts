import { createElement, useEffect, useRef } from "react";
import type { ElementType, ReactNode, RefObject } from "react";
import { enable } from "./enable.js";
import type { EnableOptions } from "./enable.js";

/**
 * React Hook：loading 为真时对 ref 指向的元素开启骨架，变假或卸载时关闭。
 * opts 里的字段请传原始值，字段变化时 Hook 会重新同步。
 * 前提：入口处引入一次基底样式（`skeletonizer/base.css` 或 `explicit.css`），pulse / shimmer 再引入 `skeletonizer/global` 或 `/svg`（或一次引入 `skeletonizer/all`）。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 * @param ref 目标元素的 ref
 * @param loading 是否加载中
 * @param opts 骨架选项（effect / text / fallback / engine / fps / fit）
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * useSkeleton(ref, loading, { effect: 'pulse' });
 * return <div ref={ref}>...</div>;
 */
export function useSkeleton(ref: RefObject<HTMLElement | null>, loading: boolean, opts: EnableOptions = {}): void {
  const { effect, text, fallback, engine, fps, fit } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!loading || !el) return undefined;
    return enable(el, { effect, text, fallback, engine, fps, fit });
  }, [ref, loading, effect, text, fallback, engine, fps, fit]);
}

/** SkzBox 组件的 props */
export interface SkzProps extends EnableOptions {
  /** 是否加载中 */
  loading: boolean;
  /** 包裹元素标签，默认 div */
  as?: ElementType;
  /** 子节点（真实组件 + mock 数据） */
  children?: ReactNode;
  /** 透传给包裹元素的 class */
  className?: string;
}

/**
 * 组件版：渲染一个包裹元素并按 loading 开关骨架。
 * 前提：入口处引入一次基底样式（`skeletonizer/base.css` 或 `explicit.css`），pulse / shimmer 再引入 `skeletonizer/global` 或 `/svg`（或一次引入 `skeletonizer/all`）。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 * @example
 * <SkzBox loading={loading}><UserCard user={user} /></SkzBox>
 */
export function SkzBox({ loading, as = "div", children, className, ...opts }: SkzProps) {
  const ref = useRef<HTMLElement>(null);
  useSkeleton(ref, loading, opts);
  return createElement(as, { ref, className }, children);
}
