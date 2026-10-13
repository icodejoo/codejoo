/**
 * SolidJS 适配层：`skeleton` 指令与 `<SkzBox>` 组件，按 loading 自动开关骨架。
 * 前提：入口处导入一次 `skeletonizer`（完整版）或 `skeletonizer/lite`（只导入一个，样式随之自带）；适配层不含 core，通过私有全局键取实现，未导入时开发模式报错。
 * text / engine 等完整版选项只有导入完整版后才有类型与效果。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 * 不用 JSX 书写，产物无需 solid 的编译插件。
 */
import { createComponent, createEffect, createSignal, onCleanup, splitProps } from "solid-js";
import type { JSX as SolidJSX } from "solid-js";
import { Dynamic } from "solid-js/web";
// 类型来自 skeletonizer/lite（导入完整版后自动变宽）；运行时只经 adapter-api 取全局 API，不含 core 代码
import type { EnableOptions, SkzBareAttr, SkzHtmlAttributesFor } from "skeletonizer/lite";
import { disable, toggle } from "./adapter-api.js";

/** skeleton 指令的参数（只接受对象：Solid 的 use: 指令值经 accessor 读取，布尔简写意义不大） */
export interface SkzParams extends EnableOptions {
  /** 是否加载中 */
  loading: boolean;
}

declare module "solid-js" {
  namespace JSX {
    /** 让 JSX 里的 skz-* 属性有补全与取值检查（导入本适配层即生效）；裸写法 `<img skz-bone>` 在 Solid 里是 `true`，所以多收一个 true */
    interface HTMLAttributes<T> extends SkzHtmlAttributesFor<SkzBareAttr | true> {}
    /** 让 `use:skeleton={{ loading: loading() }}` 有类型 */
    interface Directives {
      skeleton: SkzParams;
    }
  }
}

/**
 * Solid 自定义指令：`<div use:skeleton={{ loading: loading(), effect: "pulse" }}>`。
 * 只在 `use:` 里出现时 TypeScript 会把 import 当成未使用删掉，使用方文件里需要引用一次：`import { skeleton } from "skeletonizer/solid"; void skeleton;`。
 * @param el 目标元素（Solid 自动传入）
 * @param accessor 返回参数的函数，内部读到的信号变化会重新同步
 * @example
 * <div use:skeleton={{ loading: loading() }}><UserCard user={user()} /></div>
 */
export function skeleton(el: HTMLElement, accessor: () => SkzParams): void {
  createEffect(() => {
    const params = accessor();
    toggle(el, params.loading, params);
  });
  onCleanup(() => disable(el));
}

/** SkzBox 自己消费的 props，其余原样当作骨架选项（含自定义扩展的选项）透传给 enable */
const OWN_PROPS = ["loading", "as", "children", "class"] as const;

/** SkzBox 组件的 props */
export interface SkzBoxProps extends EnableOptions {
  /** 是否加载中 */
  loading?: boolean;
  /** 包裹元素标签，默认 div */
  as?: string;
  /** 子节点（真实组件 + mock 数据） */
  children?: SolidJSX.Element;
  /** 透传给包裹元素的 class */
  class?: string;
}

/**
 * 组件版：渲染一个包裹元素并按 loading 开关骨架。
 * @param props 组件属性
 * @returns 包裹元素
 * @example
 * <SkzBox loading={loading()}><UserCard user={user()} /></SkzBox>
 */
export function SkzBox(props: SkzBoxProps): SolidJSX.Element {
  const [own, opts] = splitProps(props, OWN_PROPS);
  const [el, setEl] = createSignal<HTMLElement>();
  createEffect(() => {
    const node = el();
    if (!node) return;
    // 整体拷贝以追踪全部选项字段
    toggle(node, !!own.loading, Object.assign({}, opts) as EnableOptions);
    onCleanup(() => disable(node));
  });
  return createComponent(Dynamic, {
    get component() {
      return own.as ?? "div";
    },
    ref: setEl,
    get class() {
      return own.class;
    },
    get children() {
      return own.children;
    },
  });
}
