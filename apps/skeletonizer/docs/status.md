---
title: 当前状态与待办
status: active
updated: 2026-10-13
summary: 原型已跑通的范围、没做的事、下一步。
---

## TL;DR

设计已拍板，桌面 Chrome 验证通过，单测全绿（含类型测试与产物测试），0.1.0、0.2.0 已发布 npm，0.3.0 即将发布。2026-10-13 入口改名与产物合并：产物只剩 full / lite 两个自包含构建加三个适配层（12 个文件，随后拆出 `<skz-box>` 入口 `element` 后为 14 个），默认入口改为完整版（见设计总结 Q39）。2026-10-10 包拆成 core + 完整版并列两种用法（0.3.0 起叫 lite 与完整版）、CSS 重新分层；2026-10-11 默认改为显式标记（`skz-text` / `skz-bone` / `skz-leaf`，推导只在 `skz-auto` 区域）、默认文字模式改为 `round`（0.2.0）。core 的规模上限有实测（见 `bench/2026-10-10-core/NOTES.md`）。其他浏览器（Firefox / Safari）、真机验证、视觉快照测试还没开始。

## 已完成

- 性能评估与优化（默认 fade、去掉元素级动画默认、`enable()` 阈值保护（后已移除）），见 [性能报告](reports/2026-10-08-performance.md)
- 设计总结 [overview](design/overview.md)
- 核心：`Bone`、`enable/disable`、`skz-host` 标记（Web Component 宿主）、`<skz-box>`（`skeletonizer/element`）、Vue / React / Svelte / Solid 适配层（Angular 走 README 里的示例指令或 `<skz-box>`）
- 基底 + 变体拆包（0.3.0 起合并为 `full` / `lite` 两个构建，见下），继承防火墙、svg 运行时精确颜色、老浏览器默认 SVG 降级，见性能报告第 10、11 节
- 根标记改为属性 `skz`（去掉 MutationObserver）；懒渲染（共享 `IntersectionObserver`）；忽略区保持可交互；移除 `maxAnimated` 自动降级，由调用方选效果
- 空闲环境性能复测，class 与属性根标记 A/B 对比，见性能报告第 6 节
- 三档 CSS（0 / 1 / 2，0.3.0 起没有兜底层）+ 基底效果 + 两个方案（global / svg），源码 `src/styles/`，CSS 入口在 `src/styles/entries/`，由 vite 多入口编译产出 `dist/`
- demo 页：十余个场景（含 `skz-host` Web Component 与 `<skz-box>` 区块）、档位切换、深色、效果 / 方案切换
- 验证：[原型验证报告](reports/2026-10-08-prototype-verification.md)
- 控制变量全量性能矩阵，README「方案怎么选 / 方案对比」据此重写，见 [矩阵报告](reports/2026-10-09-benchmark-matrix.md)
- 按矩阵剔除：删除 `fps` JS 计时器（实际从未生效，无列表结构改推荐 `engine: "svg"`）；`--skz-shimmer-timing` 降帧当时也删了（只测了样式重算，无收益），**2026-10-10 已重新引入并默认开启**（见下）
- 新增 `fit` 选项：骨架自身不撑出滚动条
- 默认文字模式改为 `clip`（下划线 + background-clip:text，文字条有光带，svg 下也能动；`underline` 需显式写，最便宜）；补测见 [矩阵报告](reports/2026-10-09-benchmark-matrix.md)（`bench/2026-10-09-clip-default/`）：fade / solid 没变贵，shimmer GPU 约 3 倍，pulse + global 16000 元素掉到 24 帧（待查防火墙是否被绕过），4× 降速下 svg shimmer 12.8 帧；原型数据见 `bench/agents/a7-clip-underline/`，Firefox / Safari 未验证

- 2026-10-10 落地：shimmer 光带默认降频 24 次/秒（`--skz-shimmer-timing: steps(36)`，只对 global，4× CPU 降速下默认档无收益）；clip 下 shimmer 根不再挂 pulse（underline / tofu / iOS 才挂，同样降频）；clip 根去掉 `--skz-tbg` / `--skz-timg` 转发（修 pulse + clip 绕过防火墙）（pulse + clip 2000 卡 22.8 帧 / 33.7 ms → 60.4 帧 / 6.95 ms）；新增可选 `text: "tofu"` 与 `tofu.css`（方块字体，`scripts/gen-tofu-font.py` 生成，没引 `tofu.css` 时退回 underline 外观，CSP 需 `font-src data:`）；`registerCustomElements` 宿主 `::before` 读动画变量（pulse / shimmer 对 Web Component 宿主生效）。复测见 [矩阵报告](reports/2026-10-09-benchmark-matrix.md)「落地复测」与 `bench/2026-10-10-landing/`
- 2026-10-10 拆包与分层：包拆成 core（`skeletonizer`，默认，现代浏览器、单个根约 2000 元素以内）与完整版（`skeletonizer/full`，上限高得多）并列，`registerExtension` 变成通用扩展点（方案注册改名 `registerEngine`），全局 `skz`、类型随版本变宽、开发模式警告；CSS 分成 `core.css` / `explicit.css` / `base.css` / `global.css`，根驱动挪进各基底，`explicit.css` 恢复懒渲染规则。验证见 `bench/2026-10-10-layering/`（逐规则对比、计算样式 + 截图、老浏览器模拟）与 `bench/2026-10-10-core/`（core 实测：125 / 250 / 500 卡 × fade·solid·pulse·shimmer，对照完整版，4× 降速，规模上限）。README（中英）、`llms.md`、ARCHITECTURE 按新结构重写：开头并列对比表、两条快速开始、迁移说明、每项标明属于 core 还是完整版
- 2026-10-10 文档补齐：README（中英）加「类型」章节与无打包器（import map）示例，补按钮 / clip / tofu / 降频的限制，功能总表性能数字统一到默认 clip 口径（未重测的标「underline 时测得」），修正防火墙机制、`engine` 指定未引入方案的实测表现、体积表；`llms.md` 补 `enable` 选项、`<skz-box>` 属性、适配层导出与全部主题变量速查

- 2026-10-11 0.2.0：默认显式标记，根上的文字模式属性改名 `skz-text-mode`，`skz-text` 变成元素级标记，自动推导（第 0 档 / 兜底层 / 图标 / 控件 / leaf / tofu）只在 `skz-auto` 区域里生效；移除 `skz-has-ignore`，忽略区只靠 `skz-ignore`；新增文字模式 `round` 并成为默认（与 clip 共用规则，根上切四个内部变量，不支持 `box-decoration-break` 时降级为 clip）；`explicit.css` 含义改为「不含 `skz-auto` 推导」；规则改用 `:is()` / `:where()`（Chrome 88+ / Safari 14+ / Firefox 84+，标记规则里的 `:not()` 用了选择器列表）。README（中英）、`llms.md`、ARCHITECTURE、设计总结按新默认重写，对比章节的性能数据仍是 0.2.0 之前在 clip 下测的（未重跑）。原型与截图在 `bench/agents/a9-round-bar/`、`a10-round-default/`、`a11-demo-round/`
- 2026-10-13 移除 tofu 文字模式：删除 `tofu.css` 入口、`scripts/gen-tofu-font.py`、`_tofu*.scss`，`text` 选项只剩 round / clip / underline / leaf，旧写法 `skz-text-mode="tofu"` 退回 underline 外观。依据：underline / tofu 成对压测里 tofu 没有任何场景更快（shimmer global 样式重算 +16%~33%，pulse global +46%~102%，开启耗时约翻倍），见 [对比报告](reports/2026-10-13-tofu-vs-underline.md)。旧数据保留在各报告里，已标注。
- 2026-10-13 0.3.0 入口改名与产物合并：`dist/` 从 37 个文件收成 12 个（`full.mjs` + `full.css`、`lite.mjs` + `lite.css`、`vue` / `react` / `svelte.mjs`，及对应 `.d.mts`，没有哈希 chunk）；默认入口 `skeletonizer` = 完整版（原 `all`），`skeletonizer/lite` = 原 core；删除 `explicit`、`full` / `global` / `svg` / `all` 子路径、`*-js` 与 `node` 条件、旧 CSS 子路径（只留 `full.css` / `lite.css`）；每个 JS 自带自己的 CSS 导入并内联一份 core；适配层改走私有全局键 `globalThis[Symbol.for("skeletonizer")]`，不再内联 core，没导入实现时开发模式警告；类型以 lite 为底，完整版 d.mts 增强 `"skeletonizer/lite"`。体积（gzip）：full 7.78 KB（JS 5.16 + CSS 2.61）、lite 4.64 KB（JS 2.74 + CSS 1.89）、适配层 vue 0.87 / react 0.64 / svelte 0.49 KB。已知代价：没有打包器的纯 Node / 浏览器直引不能直接 import（JS 里有 CSS 导入），文档写了 SSR 与 import map 的替代做法。
- 2026-10-13 0.3.0 瘦身与清理：删除兜底层与退出兜底层（两者都带 `:is()`，兜底层在任何浏览器里都看不到，退出规则还有副作用）；删除 sweep 效果与 `--skz-sweep-*` 变量、未打包的 `_legacy-fallback.scss`；开发警告改成每个调用点用 `try { if (process.env.NODE_ENV !== "production") … } catch {}` 守卫（生产打包后调用和文案都被折叠，测试里用生产 / 开发两种 vite 构建验证）；JS 目标保持 ES2015、CSS 目标 chrome88 / firefox84 / safari14；`registerCustomElements` 只用 `<style>`；`Bone` 改为普通对象；`fit.ts` 去重。体积（gzip）：full 7.19 KB（JS 4.96 + CSS 2.23）、lite 4.54 KB（JS 2.65 + CSS 1.89）。
- 2026-10-13 0.3.0 `skz-host` 与 `element` 入口：删除 `registerCustomElements`（及 `RegisterOptions`、`skz.registerCustomElements`、`src/full/hosts.ts`），改为使用者给 Web Component 宿主写 `skz-host`，静态规则在 `_marks.scss`（lite.css / full.css 共有）；`<skz-box>` 拆到独立入口 `skeletonizer/element`（`element.mjs` 0.77 KB gzip，只有胶水，导入无副作用，需手动 `defineSkzBox()`），全局 `skz` 只剩 `enable` / `disable` / `bone`；`sideEffects` 收窄到 full / lite。`dist/` 14 个文件。体积（gzip）：full.mjs 3.87 + full.css 2.31 = 6.18 KB，lite.mjs 2.22 + lite.css 1.97 = 4.19 KB（对比此前基线：full.mjs -989 B、lite.mjs -376 B、两份 CSS 各 +60 B 左右）。见设计总结 Q43。
- 2026-10-13 0.3.0 新增 Solid 适配层：`skeletonizer/solid`（`skeleton` 指令 + `SkzBox` 组件，不用 JSX，`solid-js` 可选 peer `>=1.6.0`），`dist/` 增至 16 个文件；solid.mjs 1103 B raw / 652 B gzip（0.64 KB）；测试里 solid-js 经 vitest alias 指向浏览器构建（只影响测试）。
- 2026-10-13 0.3.0 shimmer 行程参考宽度：even 模式 100vw 换成 `100cqw`（没有容器时等同视口宽），不认 cqw 时 `@supports` 回退 100vw；三档时长保留；不做封顶、不做 JS 量根宽；Playwright 实测 2560 屏、400px 容器里 60px 骨头光带在骨头上 0.37s → 1.62s
- 2026-10-13 0.3.0 收尾：`<skz-box>` 入口由 `wc` 改名 `element`（`skeletonizer/element`、`dist/element.mjs`）；README 增加 Angular 用法（不出适配层：Angular 库需 ng-packagr 编译成 partial Ivy，成本过高；给可复制的指令示例与 `<skz-box>` + `CUSTOM_ELEMENTS_SCHEMA` 写法）；三条开发警告改成英文（产物里不再有中文字符）。体积（gzip -9）：full 6.18 KB（JS 3.87 + CSS 2.31）、lite 4.19 KB（JS 2.22 + CSS 1.97），element 0.77 / vue 0.79 / react 0.57 / svelte 0.42 / solid 0.64 KB。
- 2026-10-13 0.3.0 skz-\* 属性编辑器提示：单一数据源 `src/attributes.ts`，`scripts/gen-editor-data.mjs` 生成 `web-types.json`（WebStorm）与 `html-custom-data.json`（VS Code），`pnpm build` 先跑一遍、生成物提交入库；共享类型 `SkzHtmlAttributes` 由 lite 导出，react / solid / svelte / vue 适配层用模块增强并入各自的 `HTMLAttributes`；测试 `test/editor-data.test.ts` + 类型测试（React / Solid JSX）。README 属性表补上遗漏的 `skz-shimmer-mode`。同时修正文档里过期的 shimmer 参数（档数 38 / 58 / 77、扫过占比 80% / 85.714% / 88.889%、24 次/秒 = 扫过秒数 × 24）。未在真实编辑器验证 WebStorm / VS Code / Volar / svelte-check。

## 待办（按优先级）

1. 真机 / 其他引擎验证：iOS Safari（降频、iOS 分支的 pulse 与防火墙目前只在 Chrome 里模拟）、Safari、Firefox（报告里的"未验证"项；含 clip 的装饰线裁剪；lite 与完整版目前都只在 Chrome 实测）
2. 4× 降速下 underline 样式重算 55~60 ms 的原因；lite（原 core）在 4× 降速下的规模上限偏低（数据见 `bench/2026-10-10-core/NOTES.md`）；svg 引擎 clip 的 PrePaint 降不动的根因；24 次/秒的光带台阶感需要真人观感评审
3. PostCSS + autoprefixer（先确认依赖）
4. Vitest + Playwright 三引擎视觉快照，强制单档 CSS 的降级快照
5. 框架使用示例文档（Vue 指令 / React / Svelte / Solid）
6. 评估运行时测量模式作为精确文字骨头的逃生口
7. round 补测：把对比章节的矩阵按 round 默认重跑一遍（目前只有 a9 原型「GPU 约为 clip 一半」这一条）；Firefox / Safari 上 `box-decoration-break` 的行为与条高
8. pulse + global + underline 在 2000 卡（16000 元素）回退待查：2026-10-13 压测里只有 23 帧 / 样式重算 39.5 ms，2026-10-10 落地复测同场景是 60.4 帧 / 9.66 ms；疑似 0.2.0 之后的回退，或测试页写法差异，未定位（见 [对比报告](reports/2026-10-13-tofu-vs-underline.md) 附带发现）

## 怎么跑

```
pnpm dev            # demo 开发服务（5188），改 src/styles/*.scss 热更新
pnpm test           # vitest
pnpm check          # oxfmt + oxlint（含类型检查）
pnpm build          # vp pack 产出 dist/（发布用）
```
