/**
 * 类型测试：只导入 lite 时，完整版的选项 / 效果 / 全局 API 都不存在。
 * 依赖构建产物（dist/*.d.mts）经 package.json exports 解析 "skeletonizer/lite" 与 "skeletonizer"，由 test/types.test.ts 用 tsgo 编译。
 * @ts-expect-error 用得不对（即这里没报错）本身就是测试失败。
 */
import skzDefault, { enable, Bone } from "skeletonizer/lite";
import { skeleton as solidSkeleton, SkzBox as SolidSkzBox } from "skeletonizer/solid";
import type { SkzParams as SolidParams, SkzBoxProps as SolidBoxProps } from "skeletonizer/solid";
import { defineSkzBox, SkzBox as ElementSkzBox } from "skeletonizer/element";
// @ts-expect-error <skz-box> 已拆到 skeletonizer/element，lite 不再导出
import { defineSkzBox as removedDefine } from "skeletonizer/lite";
import type { EnableOptions, SkzEffect, SkzGlobal } from "skeletonizer/lite";
import { useSkeleton as useReact } from "skeletonizer/react";
import type { SkzProps } from "skeletonizer/react";
import { skeleton } from "skeletonizer/svelte";
import type { SkzParams } from "skeletonizer/svelte";
import { SkzBox as VueSkzBox, useSkeleton as useVue } from "skeletonizer/vue";
import type { SkzBinding } from "skeletonizer/vue";
import type { Ref } from "vue";
import type { RefObject } from "react";
import type { JSX } from "solid-js";

declare const el: HTMLElement;
declare const reactRef: RefObject<HTMLDivElement | null>;
declare const vueRef: Ref<HTMLElement | null>;
declare const loading: Ref<boolean>;

// core 自带的选项能用
enable(el, { effect: "pulse", fit: true });
enable(el, { effect: "shimmer" });
const effect: SkzEffect = "solid";
const opts: EnableOptions = { effect, fit: false };
enable(el, opts);
defineSkzBox();
defineSkzBox("my-box");
const boxClass: typeof HTMLElement = ElementSkzBox;

// 完整版选项在 lite 下报错
// @ts-expect-error lite 没有 text
enable(el, { text: "leaf" });
// @ts-expect-error lite 没有 shimmerMode
enable(el, { shimmerMode: "fit" });
// @ts-expect-error lite 没有 engine
enable(el, { engine: "svg" });
// @ts-expect-error lite 没有 fallback
enable(el, { fallback: "fade" });

// 全局 skz：core 的 API 有类型，bone 是 Bone 类本身
const text: string = skz.bone.text(5);
// 默认导入与全局 skz 同一形状
const viaDefault: string = skzDefault.bone.text(3);
skzDefault.enable(el, { effect: "shimmer" });
// @ts-expect-error registerCustomElements 已移除（改用 skz-host 标记）
skzDefault.registerCustomElements();
const same: typeof Bone = skz.bone;
skz.enable(el, { effect: "fade" });
skz.disable(el);
// @ts-expect-error 全局 skz 上没有 defineSkzBox（改从 skeletonizer/element 导入）
skz.defineSkzBox();
const g: SkzGlobal = skz;
// @ts-expect-error registerCustomElements 已移除
skz.registerCustomElements(document);

// 适配层：react
useReact(reactRef, true, { effect: "pulse", fit: true });
// @ts-expect-error lite 没有 text
useReact(reactRef, true, { text: "leaf" });
const reactProps: SkzProps = { loading: true, effect: "shimmer" };
// @ts-expect-error lite 没有 engine
const reactBad: SkzProps = { loading: true, engine: "svg" };

// 适配层：svelte
skeleton(el, { loading: true, effect: "pulse" });
// @ts-expect-error lite 没有 text
skeleton(el, { loading: true, text: "leaf" });
// @ts-expect-error 不存在的效果
const svelteBad: SkzParams = { loading: true, effect: "nope" };

// 适配层：solid
solidSkeleton(el, () => ({ loading: true, effect: "pulse" }));
// @ts-expect-error lite 没有 text
solidSkeleton(el, (): SolidParams => ({ loading: true, text: "leaf" }));
// @ts-expect-error 不存在的效果
const solidBad: SolidParams = { loading: true, effect: "nope" };
const solidBox: typeof SolidSkzBox = SolidSkzBox;
// @ts-expect-error lite 没有 engine
const solidBoxBad: SolidBoxProps = { engine: "svg" };
// 指令类型：use:skeleton 的参数类型来自 JSX.Directives
const directive: JSX.Directives["skeleton"] = { loading: true, fit: true };
// @ts-expect-error lite 没有 text
const directiveBad: JSX.Directives["skeleton"] = { loading: true, text: "leaf" };

// 适配层：vue
useVue(vueRef, loading, { effect: "pulse" });
// @ts-expect-error lite 没有 text
useVue(vueRef, loading, { text: "leaf" });
const binding: SkzBinding = { loading: true, effect: "shimmer" };
// @ts-expect-error lite 没有 text
const bindingBad: SkzBinding = { loading: true, text: "leaf" };
type VueProps = InstanceType<typeof VueSkzBox>["$props"];
const vueProps: VueProps = { loading: true, effect: "pulse", fit: true, as: "section" };
// @ts-expect-error lite 没有 text
const vueBad: VueProps = { text: "leaf" };

export { boxClass, removedDefine, viaDefault, text, same, g, reactProps, reactBad, svelteBad, solidBad, solidBox, solidBoxBad, directive, directiveBad, binding, bindingBad, vueProps, vueBad };

// skz-* 属性：lite 只有 round / clip，且没有 skz-cv
import type { HTMLAttributes as VueHtmlAttributes } from "vue";
const vueLite: VueHtmlAttributes = { "skz-effect": "shimmer", "skz-text-mode": "clip", "skz-bone": "" };
// @ts-expect-error lite 没有 leaf 文字模式
const vueLiteBad: VueHtmlAttributes = { "skz-text-mode": "leaf" };
// @ts-expect-error lite 没有 skz-cv
const vueLiteCv: VueHtmlAttributes = { "skz-cv": "" };
export { vueLite, vueLiteBad, vueLiteCv };
