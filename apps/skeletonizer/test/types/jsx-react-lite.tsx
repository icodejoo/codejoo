/**
 * 类型测试：只导入 lite 时，React JSX 里完整版独有的 skz-text-mode 取值报错（JSX 对带连字符的未声明属性不报错，所以 skz-cv / skz-shimmer-mode 只是没有补全，不测）。
 * 依赖构建产物，由 test/types.test.ts 用 tsgo（--jsx react-jsx）编译。
 */
import "skeletonizer/lite";
import "skeletonizer/react";

export const ok = (
  <div skz="" skz-effect="shimmer" skz-text-mode="clip">
    <img skz-bone="" alt="" />
  </div>
);

export const bad = (
  <>
    {/* @ts-expect-error lite 的 skz-text-mode 只有 round / clip */}
    <div skz-text-mode="leaf" />
  </>
);
