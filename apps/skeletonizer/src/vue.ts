/**
 * Vue 3 适配层：`v-skeleton` 指令、`useSkeleton` 组合式 API 与 `<SkzBox>` 组件，按 loading 自动开关骨架。
 * 前提：入口处导入一次 `skeletonizer`（完整版）或 `skeletonizer/lite`（只导入一个，样式随之自带）；适配层不含 core，通过私有全局键取实现，未导入时开发模式报错。
 * text / engine 等完整版选项只有导入完整版后才有类型与效果。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 */
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { App, DefineComponent, Directive, Ref } from "vue";
// 类型来自 skeletonizer/lite（导入完整版后自动变宽）；运行时只经 adapter-api 取全局 API，不含 core 代码
import type { EnableOptions, SkzHtmlAttributes } from "skeletonizer/lite";
import { disable, toggle } from "./adapter-api.js";

/** v-skeleton 的绑定值：布尔，或带选项的对象 */
export type SkzBinding = boolean | (EnableOptions & { loading: boolean });

/**
 * 把绑定值同步到元素：loading 为真开启骨架，否则关闭。
 * @param el 目标元素
 * @param value 绑定值
 */
function apply(el: HTMLElement, value: SkzBinding): void {
  const opts = typeof value === "object" ? value : { loading: value };
  toggle(el, opts.loading, opts);
}

/**
 * Vue 3 指令：`v-skeleton="loading"` 或 `v-skeleton="{ loading, effect: 'pulse' }"`。
 * @example
 * <div v-skeleton="loading"><UserCard :user="user" /></div>
 */
export const vSkeleton: Directive<HTMLElement, SkzBinding> = {
  // 挂载、更新时按绑定值开关；卸载时一定撤掉
  mounted: (el, { value }) => apply(el, value),
  updated: (el, { value }) => apply(el, value),
  unmounted: (el) => disable(el),
};

/**
 * 组合式 API：随 loading 开关目标元素的骨架态，卸载时自动关闭。
 * 目标元素晚挂载（v-if）或被替换时会自动跟随：旧元素的骨架撤掉，新元素按当前 loading 对齐。
 * @param target 目标元素的模板引用
 * @param loading 是否加载中
 * @param opts 骨架选项（含自定义扩展的额外选项）
 * @example
 * const el = ref<HTMLElement>();
 * useSkeleton(el, loading, { effect: 'pulse' });
 */
export function useSkeleton(target: Ref<HTMLElement | null | undefined>, loading: Ref<boolean>, opts: EnableOptions = {}): void {
  // 上一次对齐过的元素：目标被替换或置空时靠它撤掉旧元素
  let current: HTMLElement | null | undefined;
  // 按当前 loading 把目标元素的骨架态对齐
  const sync = (): void => {
    const el = target.value;
    if (current && current !== el) disable(current);
    current = el;
    if (el) toggle(el, loading.value, opts);
  };
  // flush: post：等 DOM 更新后再对齐，v-if 挂载出的目标此时 ref 已经有值；
  // immediate：setup 时先跑一次（目标还没挂上就什么也不做，非模板 ref 已有元素则直接对齐），
  // 模板 ref 在挂载中被赋值会再触发一次 post watcher，所以不再另挂 onMounted，避免挂载时同步两次
  watch([target, loading], sync, { flush: "post", immediate: true });
  onBeforeUnmount(() => current && disable(current));
}

/**
 * SkzBox 组件的 props：选项部分继承 EnableOptions，导入完整版后自动多出 text / shimmerMode / engine / fallback。
 * 注意：Vue 只透传下面声明过的 props，自定义扩展的额外选项不会传给 enable，请改用 useSkeleton 或 v-skeleton。
 */
export interface SkzBoxProps extends EnableOptions {
  /** 是否加载中 */
  loading?: boolean;
  /** 包裹元素的标签名，默认 div */
  as?: string;
}

/**
 * 组件版：`<SkzBox :loading="loading" effect="pulse">...</SkzBox>`，渲染一个包裹元素；as 变化换了元素时，旧元素的骨架会撤掉，新元素重新挂上。
 * 注意：模板里写 `<SkzBox>`；写成 `<skz>` 会解析成原生自定义元素而不是这个组件。
 * 类型显式标成 DefineComponent<SkzBoxProps>：props 类型跟着 EnableOptions 走，不会在构建时被固化。
 * 自定义扩展的额外选项在 SkzBox 上不会透传（未声明的属性进的是 attrs），请用 useSkeleton 或 v-skeleton 传。
 * @example
 * <SkzBox :loading="loading"><UserCard :user="user" /></SkzBox>
 */
export const SkzBox = defineComponent({
  name: "SkzBox",
  props: {
    /** 是否加载中 */
    loading: { type: Boolean, default: false },
    /** 动画效果 */
    effect: String,
    /** 文字骨头模式（完整版） */
    text: String,
    /** shimmer 光带模式：even（默认）/ fit（完整版） */
    shimmerMode: String,
    /** global 方案在不支持 @property 时的降级：svg（默认）/ fade（完整版） */
    fallback: String,
    /** pulse / shimmer 的实现：global / svg（完整版） */
    engine: String,
    /** 是否防止撑出滚动条 */
    fit: Boolean,
    /** 包裹元素的标签名 */
    as: { type: String, default: "div" },
  },
  setup(props, { slots }) {
    const root = ref<HTMLElement>();
    // 上一次对齐过的元素：as 变化换了 DOM 元素时，靠它撤掉旧元素（不依赖 watch 的 old 值，多次变化合并触发时也不会漏）
    let current: HTMLElement | undefined;
    // 只在 props 变化时同步（getter 里整体拷贝 props 以追踪全部已声明字段（不用对象展开：es2015 目标下会多带 helper）；自定义扩展的选项不在 props 里，不会透传），插槽内容重渲染不会触发
    const sync = (): void => {
      const el = root.value;
      if (current && current !== el) disable(current);
      current = el;
      if (el) toggle(el, props.loading, props as EnableOptions);
    };
    onMounted(sync);
    // flush: post：等 patch 完成再同步，as 变了时 root.value 才已经是新元素
    watch(() => Object.assign({}, props), sync, { flush: "post" });
    // 元素被换掉（as 变化）：撤旧挂新；首次挂载已由 onMounted 对齐过（el === current），不重复同步
    watch(
      root,
      (el) => {
        if (el !== current) sync();
      },
      { flush: "post" },
    );
    onBeforeUnmount(() => root.value && disable(root.value));
    return () => h(props.as, { ref: root }, slots.default?.());
  },
}) as unknown as DefineComponent<SkzBoxProps>;

/**
 * 插件安装：全局注册 `v-skeleton` 指令与 `<SkzBox>` 组件。
 * @param app Vue 应用实例（`app.use(SkzPlugin)` 时由 Vue 传入）
 * @example app.use(SkzPlugin)
 */
export const SkzPlugin = {
  install(app: App): void {
    app.directive("skeleton", vSkeleton);
    app.component("SkzBox", SkzBox);
  },
};

/**
 * 让模板里的 skz-* 属性有补全与取值检查：把 SkzHtmlAttributes 并入 Vue 的 HTMLAttributes（导入本适配层即生效；Volar 的识别情况未在真实编辑器验证）。
 * 模板里的裸写法 `<img skz-bone>` 在 Vue 里就是 `""`。
 */
declare module "vue" {
  interface HTMLAttributes extends SkzHtmlAttributes {}
}
