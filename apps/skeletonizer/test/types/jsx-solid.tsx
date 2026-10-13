/**
 * 类型测试：Solid JSX 里的 skz-* 属性（导入完整版 + solid 适配层）。
 * 依赖构建产物，由 test/types.test.ts 用 tsgo（--jsx preserve --jsxImportSource solid-js）编译。
 */
import "skeletonizer";
import "skeletonizer/solid";

export const ok = (
  <div skz skz-effect="pulse" skz-text-mode="underline" skz-shimmer-mode="even" skz-cv>
    <img skz-bone alt="" />
    <span skz-text="" />
    <p skz-leaf skz-ignore skz-auto skz-host />
  </div>
);

export const bad = (
  <>
    {/* @ts-expect-error 不存在的效果 */}
    <div skz-effect="nope" />
    {/* @ts-expect-error 不存在的文字模式 */}
    <div skz-text-mode="tofu" />
    {/* @ts-expect-error 裸属性不收 false（Solid 会渲染成 "false"，照样命中选择器） */}
    <div skz-bone={false} />
  </>
);
