/**
 * 类型测试：React JSX 里的 skz-* 属性（导入完整版 + react 适配层）。
 * 依赖构建产物，由 test/types.test.ts 用 tsgo（--jsx react-jsx）编译；@ts-expect-error 用得不对本身就是测试失败。
 */
import "skeletonizer";
import "skeletonizer/react";

export const ok = (
  <div skz="" skz-effect="pulse" skz-text-mode="leaf" skz-shimmer-mode="fit" skz-cv="">
    <img skz-bone="" alt="" />
    <span skz-text="" />
    <p skz-leaf="" skz-ignore="" skz-auto="" skz-host="" />
  </div>
);

export const bad = (
  <>
    {/* @ts-expect-error 不存在的效果 */}
    <div skz-effect="nope" />
    {/* @ts-expect-error 不存在的文字模式 */}
    <div skz-text-mode="tofu" />
    {/* @ts-expect-error 不存在的光带模式 */}
    <div skz-shimmer-mode="nope" />
    {/* @ts-expect-error React 对未知属性传 true 会丢掉属性，类型只收 "" */}
    <div skz-bone />
  </>
);
