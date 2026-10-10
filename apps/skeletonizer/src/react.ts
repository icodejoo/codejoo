/**
 * React 适配层：`useSkeleton` Hook 与 `<SkzBox>` 组件，按 loading 自动开关骨架。
 * 前提：入口处引入一次样式（`skeletonizer` 默认带 core.css，或 `skeletonizer/explicit`）；text / engine / sweep 等完整版能力再引入 `skeletonizer/full` 或 `/global`、`/svg`、`/all`。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 */
import { createElement, useEffect, useRef } from "react";
import type { ElementType, ReactNode, RefObject } from "react";
// 直接引用 core 模块（不经过 core 入口）：不带 core.css，也不挂全局 skz
import { enable } from "./core/enable.js";
import type { EnableOptions } from "./core/types.js";

/** SkzBox 自己消费的 props，其余原样当作骨架选项（含自定义扩展的选项）透传给 enable */
const OWN_PROPS = ["loading", "as", "children", "className"];

/**
 * React Hook：loading 为真时对 ref 指向的元素开启骨架，变假或卸载时关闭。
 * opts 里的字段请传原始值（字符串 / 数字 / 布尔），内容变化时 Hook 会重新同步；原样传给 enable，自定义扩展的选项也能透传。
 * @param ref 目标元素的 ref
 * @param loading 是否加载中
 * @param opts 骨架选项（effect / text / fallback / engine / fit 等）
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * useSkeleton(ref, loading, { effect: 'pulse' });
 * return <div ref={ref}>...</div>;
 */
export function useSkeleton(ref: RefObject<HTMLElement | null>, loading: boolean, opts: EnableOptions = {}): void {
  // 用序列化后的选项当依赖：每次渲染传新对象字面量也不会反复重开，内容真变了才重新同步
  const signature = JSON.stringify(opts);
  useEffect(() => {
    const el = ref.current;
    if (!loading || !el) return undefined;
    return enable(el, opts);
    // opts 的内容已由 signature 体现，对象引用每次渲染都变，不能列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, loading, signature]);
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
 * @example
 * <SkzBox loading={loading}><UserCard user={user} /></SkzBox>
 */
export function SkzBox(props: SkzProps) {
  const ref = useRef<HTMLElement>(null);
  // 手写 omit：对象 rest 解构在 es2015 目标下会带一套 helper
  const opts: Record<string, unknown> = {};
  for (const key in props) {
    if (OWN_PROPS.indexOf(key) < 0) opts[key] = (props as unknown as Record<string, unknown>)[key];
  }
  useSkeleton(ref, props.loading, opts as EnableOptions);
  return createElement(props.as ?? "div", { ref, className: props.className }, props.children);
}
