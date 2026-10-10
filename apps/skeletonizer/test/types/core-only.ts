/**
 * 类型测试：只导入 core 时，完整版的选项 / 效果 / 全局 API 都不存在。
 * 依赖构建产物（dist/*.d.mts）经 package.json exports 解析 "skeletonizer"，由 test/types.test.ts 用 tsgo 编译。
 * @ts-expect-error 用得不对（即这里没报错）本身就是测试失败。
 */
import skzDefault, { enable, defineSkzBox, Bone } from "skeletonizer";
import type { EnableOptions, SkzEffect, SkzGlobal } from "skeletonizer";
import { useSkeleton as useReact } from "skeletonizer/react";
import type { SkzProps } from "skeletonizer/react";
import { skeleton } from "skeletonizer/svelte";
import type { SkzParams } from "skeletonizer/svelte";
import { SkzBox as VueSkzBox, useSkeleton as useVue } from "skeletonizer/vue";
import type { SkzBinding } from "skeletonizer/vue";
import type { Ref } from "vue";
import type { RefObject } from "react";

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

// 完整版选项在 core 下报错
// @ts-expect-error core 没有 text
enable(el, { text: "leaf" });
// @ts-expect-error core 没有 sweep
enable(el, { effect: "sweep" });
// @ts-expect-error core 没有 engine
enable(el, { engine: "svg" });
// @ts-expect-error core 没有 fallback
enable(el, { fallback: "fade" });

// 全局 skz：core 的 API 有类型，bone 是 Bone 类本身
const text: string = skz.bone.text(5);
// 默认导入与全局 skz 同一形状
const viaDefault: string = skzDefault.bone.text(3);
skzDefault.enable(el, { effect: "shimmer" });
// @ts-expect-error core 的默认导出没有 registerCustomElements
skzDefault.registerCustomElements();
const same: typeof Bone = skz.bone;
skz.enable(el, { effect: "fade" });
skz.disable(el);
skz.defineSkzBox();
const g: SkzGlobal = skz;
// @ts-expect-error registerCustomElements 只在完整版
skz.registerCustomElements(document);

// 适配层：react
useReact(reactRef, true, { effect: "pulse", fit: true });
// @ts-expect-error core 没有 text
useReact(reactRef, true, { text: "leaf" });
const reactProps: SkzProps = { loading: true, effect: "shimmer" };
// @ts-expect-error core 没有 engine
const reactBad: SkzProps = { loading: true, engine: "svg" };

// 适配层：svelte
skeleton(el, { loading: true, effect: "pulse" });
// @ts-expect-error core 没有 text
skeleton(el, { loading: true, text: "leaf" });
// @ts-expect-error core 没有 sweep
const svelteBad: SkzParams = { loading: true, effect: "sweep" };

// 适配层：vue
useVue(vueRef, loading, { effect: "pulse" });
// @ts-expect-error core 没有 text
useVue(vueRef, loading, { text: "leaf" });
const binding: SkzBinding = { loading: true, effect: "shimmer" };
// @ts-expect-error core 没有 text
const bindingBad: SkzBinding = { loading: true, text: "leaf" };
type VueProps = InstanceType<typeof VueSkzBox>["$props"];
const vueProps: VueProps = { loading: true, effect: "pulse", fit: true, as: "section" };
// @ts-expect-error core 没有 text
const vueBad: VueProps = { text: "leaf" };

export { viaDefault, text, same, g, reactProps, reactBad, svelteBad, binding, bindingBad, vueProps, vueBad };
