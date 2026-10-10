/**
 * Vue 3 适配层：`v-skeleton` 指令、`useSkeleton` 组合式 API 与 `<SkzBox>` 组件，按 loading 自动开关骨架。
 * 前提：入口处引入一次样式（`skeletonizer` 默认带 core.css，或 `skeletonizer/explicit`）；text / engine / sweep 等完整版能力再引入 `skeletonizer/full` 或 `/global`、`/svg`、`/all`。
 * 加载中照常渲染真实组件，用 `Bone` 造的 mock 数据填充；空元素没有尺寸，不会出骨头。
 */
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { App, DefineComponent, Directive, Ref } from "vue";
// 直接引用 core 模块（不经过 core 入口）：不带 core.css，也不挂全局 skz
import { disable, toggle } from "./core/enable.js";
import type { EnableOptions } from "./core/types.js";

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
  mounted: (el, { value }) => apply(el, value),
  updated: (el, { value }) => apply(el, value),
  unmounted: (el) => disable(el),
};

/**
 * 组合式 API：随 loading 开关目标元素的骨架态，卸载时自动关闭。
 * @param target 目标元素的模板引用
 * @param loading 是否加载中
 * @param opts 骨架选项
 * @example
 * const el = ref<HTMLElement>();
 * useSkeleton(el, loading, { effect: 'pulse' });
 */
export function useSkeleton(target: Ref<HTMLElement | null | undefined>, loading: Ref<boolean>, opts: EnableOptions = {}): void {
  const sync = (): void => {
    if (target.value) toggle(target.value, loading.value, opts);
  };
  onMounted(sync);
  watch(loading, sync);
  onBeforeUnmount(() => target.value && disable(target.value));
}

/** SkzBox 组件的 props：选项部分继承 EnableOptions，导入完整版后自动多出 text / engine / fallback */
export interface SkzBoxProps extends EnableOptions {
  /** 是否加载中 */
  loading?: boolean;
  /** 包裹元素的标签名，默认 div */
  as?: string;
}

/**
 * 组件版：`<SkzBox :loading="loading" effect="pulse">...</SkzBox>`，渲染一个包裹元素。
 * 注意：模板里写 `<SkzBox>`；写成 `<skz>` 会解析成原生自定义元素而不是这个组件。
 * 类型显式标成 DefineComponent<SkzBoxProps>：props 类型跟着 EnableOptions 走，不会在构建时被固化。
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
    // 只在 props 变化时同步（getter 里整体拷贝 props 以追踪全部字段（不用对象展开：es2015 目标下会多带 helper），含自定义扩展的），插槽内容重渲染不会触发
    const sync = (): void => {
      if (root.value) toggle(root.value, props.loading, props as EnableOptions);
    };
    onMounted(sync);
    watch(() => Object.assign({}, props), sync);
    onBeforeUnmount(() => root.value && disable(root.value));
    return () => h(props.as, { ref: root }, slots.default?.());
  },
}) as unknown as DefineComponent<SkzBoxProps>;

/**
 * 插件安装：全局注册 `v-skeleton` 指令与 `<SkzBox>` 组件。
 * @example app.use(SkzPlugin)
 */
export const SkzPlugin = {
  install(app: App): void {
    app.directive("skeleton", vSkeleton);
    app.component("SkzBox", SkzBox);
  },
};
