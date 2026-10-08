# Changelog

## 0.1.0

- 首次发布：`enable`/`disable`、`<x-ske>`、`Bone` mock 工具、分档渐进增强的纯 CSS 骨架。
- 源码全部 TypeScript，JS 产物降级到 ES2015 并压缩，构建时产出 `.d.ts`；最低支持 CSS 变量的浏览器。
- 宿主骨架样式去掉 `inset`，改用 top/right/bottom/left，兼容 Safari < 14.1。
- 新增框架适配层：`skeletonizer/vue`（指令/组件/组合式/插件）、`skeletonizer/react`（Hook/组件）、`skeletonizer/svelte`（action）。
- `<x-ske>` 的类定义在非浏览器环境不再报错（SSR 安全）。
- 命名统一加 `x-ske` 前缀：标签 `<x-ske>`（默认注册）、根 class `.x-ske`、属性 `x-ske-ignore` / `x-ske-leaf` / `x-ske-bone` / `x-ske-effect` / `x-ske-text`、CSS 变量 `--x-ske-*`、动画 `x-ske-*`；JS 导出 `XSke` / `defineXSke` / `XSkeEffect` 等；Vue/React 组件改名 `XSke`。
