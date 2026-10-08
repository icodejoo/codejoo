import { createElement, useEffect, useRef } from "react";
import type { ElementType, ReactNode, RefObject } from "react";
import { enable } from "./enable.js";
import type { EnableOptions } from "./enable.js";

/**
 * React Hook：loading 为真时对 ref 指向的元素开启骨架，变假或卸载时关闭。
 * @param ref 目标元素的 ref
 * @param loading 是否加载中
 * @param opts 骨架选项（effect / text / maxAnimated）
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * useSkeleton(ref, loading, { effect: 'pulse' });
 * return <div ref={ref}>...</div>;
 */
export function useSkeleton(ref: RefObject<HTMLElement | null>, loading: boolean, opts: EnableOptions = {}): void {
  const { effect, text, maxAnimated } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!loading || !el) return undefined;
    return enable(el, { effect, text, maxAnimated });
  }, [ref, loading, effect, text, maxAnimated]);
}

/** XSke 组件的 props */
export interface XSkeProps extends EnableOptions {
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
 * @example
 * <XSke loading={loading}><UserCard user={user} /></XSke>
 */
export function XSke({ loading, as = "div", children, className, ...opts }: XSkeProps) {
  const ref = useRef<HTMLElement>(null);
  useSkeleton(ref, loading, opts);
  return createElement(as, { ref, className }, children);
}
