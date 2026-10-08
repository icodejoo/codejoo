import { defineComponent, h, onBeforeUnmount, onMounted, watch } from "vue";
import type { App, Directive, PropType, Ref } from "vue";
import { enable, disable } from "./enable.js";
import type { EnableOptions, XSkeEffect, XSkeTextMode } from "./enable.js";

/** v-skeleton 的绑定值：布尔，或带选项的对象 */
export type XSkeBinding = boolean | (EnableOptions & { loading: boolean });

/**
 * 把绑定值同步到元素：loading 为真开启骨架，否则关闭。
 * @param el 目标元素
 * @param value 绑定值
 */
function apply(el: HTMLElement, value: XSkeBinding): void {
  const loading = typeof value === "object" ? value.loading : value;
  if (loading) enable(el, typeof value === "object" ? value : {});
  else disable(el);
}

/**
 * Vue 3 指令：`v-skeleton="loading"` 或 `v-skeleton="{ loading, effect: 'pulse' }"`。
 * @example
 * <div v-skeleton="loading"><UserCard :user="user" /></div>
 */
export const vSkeleton: Directive<HTMLElement, XSkeBinding> = {
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
    if (target.value) apply(target.value, { ...opts, loading: loading.value });
  };
  onMounted(sync);
  watch(loading, sync);
  onBeforeUnmount(() => target.value && disable(target.value));
}

/**
 * 组件版：`<XSke :loading="loading" effect="pulse">...</XSke>`，渲染一个包裹元素。
 * @example
 * <XSke :loading="loading"><UserCard :user="user" /></XSke>
 */
export const XSke = defineComponent({
  name: "XSke",
  props: {
    /** 是否加载中 */
    loading: { type: Boolean, default: false },
    /** 动画效果 */
    effect: String as PropType<XSkeEffect>,
    /** 文字骨头模式 */
    text: String as PropType<XSkeTextMode>,
    /** 最大动画元素数 */
    maxAnimated: Number,
    /** 包裹元素的标签名 */
    as: { type: String, default: "div" },
  },
  setup(props, { slots }) {
    return () =>
      h(
        props.as,
        {
          onVnodeMounted: (v: { el: unknown }) => apply(v.el as HTMLElement, toBinding(props)),
          onVnodeUpdated: (v: { el: unknown }) => apply(v.el as HTMLElement, toBinding(props)),
          onVnodeBeforeUnmount: (v: { el: unknown }) => disable(v.el as HTMLElement),
        },
        slots.default?.(),
      );
  },
});

/**
 * 把组件 props 转成指令绑定值。
 * @param p 组件 props
 */
function toBinding(p: { loading: boolean; effect?: XSkeEffect; text?: XSkeTextMode; maxAnimated?: number }): XSkeBinding {
  return { loading: p.loading, effect: p.effect, text: p.text, maxAnimated: p.maxAnimated };
}

/**
 * 插件安装：全局注册 `v-skeleton` 指令与 `<XSke>` 组件。
 * @example app.use(XSkePlugin)
 */
export const XSkePlugin = {
  install(app: App): void {
    app.directive("skeleton", vSkeleton);
    app.component("XSke", XSke);
  },
};
