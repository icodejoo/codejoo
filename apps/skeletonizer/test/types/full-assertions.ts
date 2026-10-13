/**
 * 类型测试：导入完整版（由via-full.ts 的 import 触发）后，lite 的类型自动变宽。
 * 与 lite-only.ts 对照：同样的写法这里全部通过。依赖构建产物，由 test/types.test.ts 用 tsgo 编译。
 */
import skzDefault, { enable } from "skeletonizer";
import type { EnableOptions, SkzEffect } from "skeletonizer";
import { useSkeleton as useReact } from "skeletonizer/react";
import type { SkzProps } from "skeletonizer/react";
import { skeleton } from "skeletonizer/svelte";
import type { SkzParams } from "skeletonizer/svelte";
import { skeleton as solidSkeleton } from "skeletonizer/solid";
import type { SkzParams as SolidParams, SkzBoxProps as SolidBoxProps } from "skeletonizer/solid";
import { defineSkzBox } from "skeletonizer/element";
import { SkzBox as VueSkzBox, useSkeleton as useVue } from "skeletonizer/vue";
import type { SkzBinding } from "skeletonizer/vue";
import type { Ref } from "vue";
import type { RefObject } from "react";
import type { JSX } from "solid-js";

declare const el: HTMLElement;
declare const reactRef: RefObject<HTMLDivElement | null>;
declare const vueRef: Ref<HTMLElement | null>;
declare const loading: Ref<boolean>;

// 完整版选项
enable(el, { text: "leaf" });
enable(el, { text: "round" });
enable(el, { effect: "shimmer" });
enable(el, { effect: "pulse", engine: "svg", fallback: "fade", text: "clip", fit: true });
const effect: SkzEffect = "shimmer";
const opts: EnableOptions = { effect, text: "underline", engine: "global", fallback: "svg" };
enable(el, opts);

enable(el, { shimmerMode: "even" });
enable(el, { effect: "shimmer", shimmerMode: "fit" });

// 取值仍然受限
// @ts-expect-error 不存在的光带模式
enable(el, { shimmerMode: "nope" });
// @ts-expect-error tofu 已移除
enable(el, { text: "tofu" });
// @ts-expect-error 不存在的文字模式
enable(el, { text: "nope" });
// @ts-expect-error 不存在的方案
enable(el, { engine: "css" });
// @ts-expect-error 不存在的效果
enable(el, { effect: "nope" });
// @ts-expect-error sweep 已移除
enable(el, { effect: "sweep" });

// 全局 skz 没有 registerCustomElements（已改为 skz-host 标记）
// @ts-expect-error registerCustomElements 已移除
skz.registerCustomElements(document);
// element 入口与完整版同处一个工程
defineSkzBox();
const text: string = skz.bone.text(5);

// 适配层
useReact(reactRef, true, { text: "leaf", engine: "svg", effect: "shimmer" });
const reactProps: SkzProps = { loading: true, engine: "svg", text: "leaf" };
skeleton(el, { loading: true, text: "leaf", effect: "shimmer" });
const svelteParams: SkzParams = { loading: true, fallback: "fade" };
solidSkeleton(el, (): SolidParams => ({ loading: true, text: "leaf", engine: "svg" }));
const solidParams: SolidParams = { loading: true, fallback: "fade" };
const solidProps: SolidBoxProps = { loading: true, text: "leaf", effect: "shimmer" };
const solidDirective: JSX.Directives["skeleton"] = { loading: true, text: "clip" };
// @ts-expect-error 取值仍然受限
const solidBad: SolidParams = { loading: true, text: "nope" };
useVue(vueRef, loading, { text: "leaf" });
const binding: SkzBinding = { loading: true, text: "leaf", engine: "global" };
type VueProps = InstanceType<typeof VueSkzBox>["$props"];
const vueProps: VueProps = { loading: true, text: "leaf", engine: "svg", fallback: "fade", effect: "shimmer" };
// @ts-expect-error Vue 组件 props 的取值也受限
const vueBad: VueProps = { text: "nope" };

skzDefault.enable(document.body, { text: "leaf", effect: "shimmer" });

export { text, reactProps, svelteParams, solidParams, solidProps, solidDirective, solidBad, binding, vueProps, vueBad };

// skz-* 属性的类型：Vue 的 HTMLAttributes 与共享类型 SkzHtmlAttributes 上有这些键（svelte 不是本包依赖，只能验共享类型，增强本身由 libCheck 保证 d.mts 不报错）
import type { HTMLAttributes as VueHtmlAttributes } from "vue";
import type { SkzHtmlAttributesFor } from "skeletonizer";
const vueAttrs: VueHtmlAttributes = { "skz-effect": "pulse", "skz-text-mode": "leaf", "skz-shimmer-mode": "fit", "skz-bone": "", skz: "", "skz-cv": "" };
// @ts-expect-error 不存在的效果
const vueAttrsBad: VueHtmlAttributes = { "skz-effect": "nope" };
const svelteLike: SkzHtmlAttributesFor<"" | true> = { "skz-bone": true, "skz-text": "" };
export { vueAttrs, vueAttrsBad, svelteLike };
