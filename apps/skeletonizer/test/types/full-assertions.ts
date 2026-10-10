/**
 * 类型测试：导入完整版（由各 via-*.ts 的 import 触发）后，core 的类型自动变宽。
 * 与 core-only.ts 对照：同样的写法这里全部通过。依赖构建产物，由 test/types.test.ts 用 tsgo 编译。
 */
import skzDefault, { enable } from "skeletonizer";
import type { EnableOptions, SkzEffect } from "skeletonizer";
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

// 完整版选项
enable(el, { text: "leaf" });
enable(el, { effect: "sweep" });
enable(el, { effect: "pulse", engine: "svg", fallback: "fade", text: "clip", fit: true });
const effect: SkzEffect = "sweep";
const opts: EnableOptions = { effect, text: "tofu", engine: "global", fallback: "svg" };
enable(el, opts);

// 取值仍然受限
// @ts-expect-error 不存在的文字模式
enable(el, { text: "nope" });
// @ts-expect-error 不存在的方案
enable(el, { engine: "css" });
// @ts-expect-error 不存在的效果
enable(el, { effect: "nope" });

// 全局 skz 多出 registerCustomElements
const hosts = skz.registerCustomElements(document, { watch: true });
hosts.refresh();
hosts.dispose();
const text: string = skz.bone.text(5);

// 适配层
useReact(reactRef, true, { text: "leaf", engine: "svg", effect: "sweep" });
const reactProps: SkzProps = { loading: true, engine: "svg", text: "leaf" };
skeleton(el, { loading: true, text: "leaf", effect: "sweep" });
const svelteParams: SkzParams = { loading: true, fallback: "fade" };
useVue(vueRef, loading, { text: "leaf" });
const binding: SkzBinding = { loading: true, text: "leaf", engine: "global" };
type VueProps = InstanceType<typeof VueSkzBox>["$props"];
const vueProps: VueProps = { loading: true, text: "leaf", engine: "svg", fallback: "fade", effect: "sweep" };
// @ts-expect-error Vue 组件 props 的取值也受限
const vueBad: VueProps = { text: "nope" };

// 导入完整版后，默认导出同样多出 registerCustomElements
const defaultHosts: () => string[] = skzDefault.registerCustomElements().refresh;
skzDefault.enable(document.body, { text: "leaf", effect: "sweep" });

export { defaultHosts, hosts, text, reactProps, svelteParams, binding, vueProps, vueBad };
