/**
 * React 适配层：`useSkeleton` Hook 与 `<SkzBox>` 组件，按 loading 自动开关骨架。
 * 前提：入口处导入一次 `skeletonizer`（完整版）或 `skeletonizer/lite`（只导入一个，样式随之自带）；适配层不含 core，通过私有全局键取实现，未导入时开发模式报错。
 * text / engine 等完整版选项只有导入完整版后才有类型与效果。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 */
import { createElement, useEffect, useRef } from "react";
import type { ElementType, ReactNode, RefObject } from "react";
// 类型来自 skeletonizer/lite（导入完整版后自动变宽）；运行时只经 adapter-api 取全局 API，不含 core 代码
import type { EnableOptions, SkzHtmlAttributes } from "skeletonizer/lite";
import { enable } from "./adapter-api.js";

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

/**
 * 让 JSX 里的 skz-* 属性有补全与取值检查：把 SkzHtmlAttributes 并入 React 的 HTMLAttributes（导入本适配层即生效）。
 * 裸属性写 `skz-bone=""`：React 对未知属性传 `true` 会丢掉属性，所以类型只收 `""`。
 */
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 类型参数必须与 React 原声明一致才能合并
  interface HTMLAttributes<T> extends SkzHtmlAttributes {}
}
