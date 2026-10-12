# Changelog

## Unreleased

- **shimmer 光带改为水平 90deg + 缓动过渡**：原来的 `linear-gradient(100deg, …)` 铺在 no-repeat 的 60vw × 100vh 背景块上，倾斜后块的左右竖边落不到 0%（1920×1080 下左下角约 28% 高光），被硬截断成一条斜边，光带尾部发硬。现在光带不倾斜，两侧按 smoothstep 取 3 个中间色标（`color-mix` 调透明度），两端和峰值都没有转折；svg 引擎的光带用同一组色标。
- **shimmer 光带固定 400px 宽，时长按屏宽分三档，每轮加停顿**：原来光带宽 60vw，大屏上一闪而过。现在光带固定 400px（内部变量 `--skz-band`），`--skz-shimmer-p` 改为 0 → 1 的进度，位置换算成「-光带宽 → 100vw」，任何屏宽下都从左侧屏外刚好进场、右侧屏外刚好离场。前 62.5% 扫过、后 37.5% 停在屏幕外再开始下一轮（停顿段值不变，不重绘）；一轮时长与降频档数按屏宽三档（小屏优先）：< 640px 2s / `steps(30)`，≥ 640px 2.8s / `steps(42)`，≥ 1280px 3.6s / `steps(54)`，扫过段都是 24 次/秒（档数 = 时长（秒）× 15）。pulse / fade / sweep 保持 2s（pulse 一个来回 4s）。自己写了 `--skz-duration` 的，pulse 和 shimmer 都用它（档位不再起作用），自己写了 `--skz-shimmer-timing` 的用你的；根上不再声明 `--skz-duration` 默认值（改为 var() 兜底，不会盖掉写在祖先上的覆盖）。svg 引擎同步（SMIL `keyTimes`）：按生成时的 `innerWidth` 取档位，光带宽按 400px 换算成 viewBox 单位，窗口缩放后不重算。
- **修复：`skz-auto` 区域里推导出的媒体 / 控件骨头没有圆角**：第 0 档的圆角规则只覆盖文字标签和 `button`，img / video / canvas / picture / iframe / svg / input / textarea / select 是直角。现在这些都读 `--skz-radius`（仍是 `:where()` 零优先级，元素自己写的圆角保留）。

## 0.2.0 - 2026-10-11

- **新增文字模式 `round`，并成为默认文字模式**（core / `explicit.css` / 完整版 `base.css` 都是；作用于显式 `skz-text` 标记和 `skz-auto` 推导区的文字）。外观：文字透明 + 带圆角的背景盒，行内元素折行后每一行各自圆角，块元素（p / h3 / div / flex 子项等）按自身 display 整块圆角矩形，不对行内 / 块做任何区分；shimmer 光带、`fixed` 背景同步、防火墙、深浅主题、driver-color 都照常。GPU 约为 clip 的一半（a9 原型实测），也不依赖「装饰线参与 `background-clip:text` 裁剪」这一只在 Chrome 实测过的行为。
  - **纯 CSS 就是默认**：根上只写 `skz` 不写 `skz-text-mode`（或写 `skz-text-mode="round"`）即 round；JS 的 `text` 选项新增 `"round"`，不传 = 不写属性 = round（与无 JS 结果一致）。
  - **不支持则降级到 clip**：round 只在 `@supports ((box-decoration-break: clone) or (-webkit-box-decoration-break: clone))` 里生效（Chrome 130 前与 Safari 只认 `-webkit-` 前缀，两种写法都查）；不支持的浏览器整块不生效，默认外观就是原来的 clip，clip 自己的降级链（不支持 `background-clip:text` 退回 underline 等）不变。
  - **结构**：不另写一套目标规则，round 与 clip 共用同一批形状 / 填充 / 圆角规则，只在 round 根上切四个变量：`--skz-ul-line: none`（装饰线种类，缺省 underline）、`--skz-bgclip: border-box`（缺省 text）、`--skz-bdb: clone`（`box-decoration-break`，缺省 slice）、`--skz-tradius: initial`（清掉 clip 的 0px，圆角回落到现有的 `--skz-radius`，不新增圆角变量）。目标规则只读这些变量、缺省值就是 clip 原来的写法，所以 round 与 clip 不会同时生效；文字条家族根（没写 / round / clip）上同时把前三个变量复位成 clip 的值，嵌套在 round 根里的 clip 根不继承外层。四个变量都是内部开关，不属于公开 API。
  - **显式 `skz-text-mode="clip"` 行为与改动前像素一致**（core / explicit 也认 `round` / `clip` 这两个取值，可以手写强制 clip；其余取值仍不认）；underline / leaf / tofu / 未知取值不受影响。
  - **已知局限**：1) 雅黑 / Segoe UI / system-ui 下 round 的条比 clip 高约 0.1~0.16em（条高 = 字体内容区，CSS 只能加高不能收窄；Arial / Georgia / Consolas / SimSun / Times 与 clip 像素一致）；2) line-height 为 1.2 时多行条可能相互叠出凹口（雅黑条高 1.32em，叠 0.12em）；3) 块元素整块：长段落是一整块矩形、短标题被拉成整行宽，`<div skz-text>` 的混合内容同样整块，没有纯 CSS 补救（要文字宽度的条，在里面包一层行内 `<span skz-text>`，或显式写 `skz-text-mode="clip"`）；4) 圆角固定读 `--skz-radius`（默认 4px），不随字号缩放；5) 只在 Chrome 154 上实测，Firefox / Safari 未验证。
  - 体积：core.css 增加约 1.2 KB（minified，gzip 约 +0.1 KB），主要是文字条家族根选择器（`:is(没写, round, clip)`）在推导前缀里重复出现。
- **BREAKING：默认改为显式标记，自动推导只在 `skz-auto` 区域里生效。** 以前 `core.css` / `base.css` 按标签白名单推断骨头，白名单外的裸文字（div / 自定义元素 / code 里直接写的字）在 clip 下不可见，只能发现一个补一个。现在默认由开发者自己标（最精准）：根上没有任何标记、也没有 `skz-auto` 的内容原样显示。给无法加标记的第三方组件用：在根自身或根内任意后代上写裸属性 `skz-auto`，推导规则（第 0 档 / 兜底层 / 图标 / 控件 / leaf / tofu）只作用于该子树；局限不变——推导区域里不在文字标签清单里的裸文字不可见（要包进 `p` / `span` 或自己标 `skz-text`）。
- **BREAKING：根上的文字模式属性 `skz-text` 改名为 `skz-text-mode`**（取值不变：clip / underline / leaf / tofu，另新增 round 并成为默认，见上；未知取值仍落 underline 外观）。JS 选项名 `text` 不变，只是写到新属性。手写根属性的要同步改。
- **新增元素级文字骨头标记 `skz-text`**（裸属性，写在根内任意后代上）：该元素整个子树的文字按文字行出条（最后一行变短）；标在容器上也覆盖混合内容（`<div skz-text>价格：<b>¥5</b></div>`）。外观跟随根上的 `skz-text-mode`：round（默认，见上）= 带圆角的背景盒；clip = 骨头背景 + `background-clip:text`；underline / tofu / 未知 = 可见下划线条；leaf = 该元素整块骨头。`core.css` / `explicit.css` 只有 round（默认）/ clip。区域内的 `skz-ignore` / `skz-bone` / `skz-leaf` 照常生效；`skz-text` 在推导区域内外都生效，只认根的后代。
- **`explicit.css` / `skeletonizer/explicit` 含义改为「不含 `skz-auto` 推导规则的精简版」**，同样支持 `skz-text`（clip）、`skz-bone`、`skz-leaf`、`skz-ignore`。`core.css` / `base.css` 都 = 显式标记规则 + 门控在 `skz-auto` 上的推导规则。
- **BREAKING：移除 `skz-has-ignore`，忽略区的修正只靠 `skz-ignore` 一个标记、纯 CSS 生效**，不再依赖 JS 往根上写属性（`enable()` 不再写它）。**不再有「含忽略区的祖先关下划线」的修正规则**（`:has([skz-ignore])` 逐元素检查整条删除）：忽略区放在 `skz-text` 元素或 `skz-auto` 区域内时，它的文字显示在骨头条之上（真实文字色压在灰条上）；想要完全干净的忽略区，把骨头文字和忽略区拆成兄弟元素，如 `<span skz-text>价格</span> <span skz-ignore>实时</span>`。根上的默认 fade 遇到忽略区改为用 `:has()` 对根自己检查一次来撤销（老浏览器不认 `:has` 时保留 fade）；tofu 里含忽略区的元素改用 `:not(:has([skz-ignore]))` 守卫。
- 根级变量（`--skz-dc` / `--skz-tbg` / 驱动变量等）仍挂在 `[skz]` 根上，不经过 `skz-auto`；CSS 完全依赖根上的 `skz` 属性开关，JS 只负责切这个开关，不用我们的 JS 自己 `setAttribute` 也能得到正确渲染（懒渲染 `skz-paused`、继承防火墙 `skz-fw`、svg 引擎 `skz-engine` 属于性能 / 降级路径，不影响正确性）。
- 第 0 档 / 推导规则改用 `:is()` / `:where()` 写区域前缀（`skz-auto` 包在 `:where()` 里，优先级与原来的单 `[skz]` 前缀一致，层叠关系不变），门槛随之为支持 `:is()` / `:where()` 的浏览器（Chrome 88+ / Safari 14+ / Firefox 84+，标记规则里的 `:not()` 用了选择器列表）。
- **体积**（`pnpm build` 实测，minified / `gzip -9 -n`，字节）：`core.css` 9572 / 1684、`explicit.css` 6186 / 1454、`base.css` 12106 / 1945、`all.css` 18777 / 4295（`global.css` 1018 / 330、`svg.css` 468 / 193、`sweep.css` 1724 / 566、`tofu.css` 3932 / 2014）；JS 闭包（gzip）core 3173、`full` 4758、`global/js` 6267、`all/js` 6400，比 0.1.0 文档里的数字各少约 30 B（`enable()` 不再写 `skz-has-ignore`）。整套组合：core 4.74 KB、`full` + `base.css` 6.55 KB、`full` + `global` 8.34 KB、`all` 10.44 KB（1 KB = 1024 B）。
- **文档**：README（中英）、`llms.md`、`ARCHITECTURE.md`、设计总结按显式标记 / `skz-auto` / `round` 重写：新增「标记骨头」与「升级到 0.2.0」两节，示例全部改为显式标记写法（块元素里包 `<span skz-text>`），体积表、浏览器支持表、属性 / 选项参考表同步；`ARCHITECTURE.md` 补上 round 的规则结构（四个内部变量、`@supports` 门控、规则顺序）。README 里的性能数据仍是 0.2.0 之前在 clip + 全根推导下测的，已在对比章节开头注明，未重跑。

## 0.1.0 - 2026-10-10

首次发布。下面前半部分是发布前最后一轮的 core / 完整版拆分（其中的"迁移说明"针对发布前的预览写法），后半部分是更早的开发记录。

- **包拆成 core + 完整版扩展**（破坏性）：
  - `skeletonizer`（根入口）现在是 **core**：`enable` / `disable` / `<skz-box>` / `Bone` / `registerExtension`，只认 `effect`（fade / solid / pulse / shimmer）和 `fit`，默认带 `core.css`（见下面的 CSS 分层）。Node / SSR 走 `node` 条件拿到不带 CSS 的纯 JS 版。默认导出 `skz` 对象（与全局 `skz` 是同一个对象，`import skz from "skeletonizer"`；`/explicit`、`/full` 同理）。
  - `skeletonizer/explicit`：core + `explicit.css`，其余同上。
  - **`skeletonizer/full`**：core + 完整版扩展，不带 CSS。文字模式（`text`）、pulse / shimmer 的方案调度（`engine` / `fallback`）、视口外暂停动画（懒渲染）、`registerCustomElements`、`sweep` 效果都在完整版。`skeletonizer/global`、`/svg`、`/all`（含 `/js`）内部自动带上完整版扩展，路径与用法不变。
  - 迁移：原来 `import { enable, registerCustomElements } from "skeletonizer"` 用到 `text` / `engine` / `fallback` / `sweep` / `registerCustomElements` 的，改成 `from "skeletonizer/full"`；只用 `effect` / `fit` 的不用改。`registerCustomElements` 只在完整版导出。适配层 `skeletonizer/vue` / `/react` / `/svelte` 路径不变，直接引用 core 模块，不带 CSS、不挂全局。
- **CSS 分层**（core 与完整版各取所需）：
  - `core.css`：目标 Chrome 119+ / Safari 16.4+ / Firefox 128+（同时具备 `@property`、相对颜色、`:has()`、`text-decoration-thickness`、`background-clip:text`）。组成 = 主题与交互锁 + 第 0 档（按标签铺静态色块）+ 显式标记 + **现代档**（clip 文字骨头、控件整块、图标启发式、忽略区下划线修正，用一个 `@supports` 同时要求 `text-decoration-thickness` 和 `:has()`）+ fade / solid / 减少动态效果 + fit + 根驱动（pulse / shimmer 纯 CSS 动画，光带降频）。低于门槛只剩第 0 档加 fade。不含兜底层、underline / leaf / tofu、防火墙、svg 降级、sweep、懒渲染（`skz-paused`）、`skz-cv`；clip 的 `@supports not (background-clip: text)` 撤回分支在 core 里删掉（门槛已保证支持）。core 的规则只认没写 `skz-text` 的根。
  - `explicit.css`（core 与完整版共用）= 主题 + 交互锁 + 显式标记 + fade / solid / 减少动态效果 + fit + 根驱动 + 懒渲染 `skz-paused` + `skz-cv`。**恢复了懒渲染规则**：`explicit.css` + 完整版 JS 的组合里视口外的根照常暂停动画；`core.css` 仍不含这两段（core 没有懒渲染扩展）。
  - `base.css`（完整版）= 兜底层（最前）+ 完整的四档推导（保留原 tier1 / tier2 的渐进行为，给"有 `text-decoration-thickness` 没有 `:has()`"之类的中间浏览器；含 underline / leaf 文字模式）+ 根驱动（gradient 驱动，加 underline / tofu 的纯色驱动）+ 懒渲染 `skz-paused` + `skz-cv`。
  - `global.css`（完整版变体）**只剩**继承防火墙 + 老浏览器 SVG 降级规则；pulse / shimmer 的根驱动（`@property`、关键帧、降频、iOS 分支）挪到各基底里，防火墙的重声明清单和 pulse 挂载选择器由 `_lists.scss` 里的"文字模式 → 驱动"表生成。`svg.css` / `sweep.css` / `tofu.css` 不变，`all.css` = `base` + `global` + `svg` + `sweep` + `tofu`。
  - **行为变化**：只引 `base.css`（或 `explicit.css`）不引 `global` 时，`pulse` / `shimmer` 在 Chrome 119+ 等支持相对颜色的浏览器里直接有纯 CSS 动画（以前退回 fade）。`global` 现在只负责防火墙（长列表优化）和老浏览器的 SVG 降级。
  - **clip 改成正向选择**：clip 根 = `[skz]:not([skz-text])` 或 `[skz][skz-text="clip"]`（以前是排除 underline / leaf / tofu）。**任何未知的 `skz-text` 取值现在落到 underline 外观**（以前落到 clip）；`tofu` 没引 `tofu.css` 时仍是 underline 外观，`leaf` 不受影响。underline / tofu / 未知取值的背景开关和纯色驱动用同一个"有 `skz-text` 且不是 clip / leaf"的挂载选择器。
  - 宿主样式 `registerCustomElements` 的背景声明与 `sk-bone` 加了漂移测试：`sk-bone` 改了而宿主没跟会让测试失败。
  - **迁移 / 不要重复引**：用 `skeletonizer/full`（或 `/all`、`/global`、`/svg`）的完整版用户**不要再引 `skeletonizer` 默认入口**（它自带 `core.css`）。两份样式同时存在时 core 的规则只认没写 `skz-text` 的根，对 clip 默认根重复且一致；但 core.css 排在完整版样式**之后**时，它的 shimmer 根规则（同优先级、后写的赢）会盖掉完整版里 underline / tofu / 未知取值根的 pulse 动画，这类根的 shimmer 颜色变成静态。只用 `skeletonizer` 默认入口的用户不受影响。
- 新增通用扩展点 `registerExtension({ name, sync, release })`（core 导出）：`enable` 每次调用按注册顺序逐个 `sync`，关闭时逐个 `release`，同名后注册的覆盖先注册的。**签名变了**：原来的 `{ engine, sync, release }`（方案扩展）改名为 `registerEngine`，现在从 `skeletonizer/full` 导出，由变体入口注册。文字模式、方案调度、懒渲染都是挂在这个扩展点上的完整版扩展。
- 全局变量 `skz`：导入 core / explicit / full 任一入口即挂上 `globalThis.skz = { enable, disable, bone, defineSkzBox }`（完整版再补 `registerCustomElements`），免 import 就能 `skz.bone.text(8)`；SSR 里同样挂。已被别人占用的 `skz` 不覆盖（开发模式警告一次）。适配层不挂。
- 类型按入口变宽：core 只有 `effect` / `fit`；导入 `skeletonizer/full`（或 `/global`、`/svg`、`/all`）后，`EnableOptions` 自动多出 `text` / `engine` / `fallback`，`SkzEffect` 多出 `sweep`，适配层 props 同步变化（`declare module "skeletonizer"` 增强，`test/types` 基于构建产物验证）。
- `<skz-box>` 始终监听 `loading` / `effect` / `text` / `fallback` / `engine` / `fit` 六个属性并原样传给 `enable`；没加载对应扩展时 `text` / `engine` / `fallback` 被忽略。
- 开发警告：显式传 `engine` 而该方案没注册（只引了 `global` 却写 `engine: "svg"`，或反过来）时，开发模式 `console.warn` 一次；生产构建里随 `process.env.NODE_ENV` 一并摘掉。
- 构建产物里保留 `process.env.NODE_ENV` 原样（不再被 rolldown 固化成 `production`），由使用方的打包器决定开发警告去留。
- 文档按 core / 完整版并列重写（README 中英、`llms.md`、ARCHITECTURE、设计总结、状态页）：开头一张对比表帮使用者选，快速开始分 core 与完整版两条线，新增迁移说明、全局 `skz`、开发模式警告、类型随版本变宽的说明；功能总表每项标明属于 core 还是完整版；体积表按新入口重量（core 4.63 KB、`explicit` 4.16 KB、`full` + `base.css` 6.39 KB，gzip）。
- core 实测与规模上限（`bench/2026-10-10-core/`，Chrome 154，clip 默认，每格新鲜加载，机器非安静状态）：桌面正常速度下 core 单个根 1000 / 2000 元素的 fade / solid / pulse / shimmer 都是 60.4 帧，4000 元素 pulse 59.2 / shimmer 60.4；6000 元素 pulse 46.4 / shimmer 58 帧，16000 元素 pulse 18.4 / shimmer 16.8 帧（完整版同规模 60.4 帧）；4× CPU 降速下 core 2000 元素只有 pulse 21.2 / shimmer 17.2 帧，504 元素 40.8 / 52 帧。建议：桌面级 CPU 上 core 单根约 4000 元素以内（保守约 2000），再大换完整版；要照顾慢设备门槛低得多。README 新增「core 的规模上限」一节。

- 去掉 CSS 里全部 SVG data URI（约 5 KB，`all.css` 里还重复了一份）：SVG 动画一律由 JS 生成 blob 图；老浏览器（不支持 `@property`）的 SVG 降级也改由 JS 完成（`global` 变体按 `CSS.supports` 检测后调用 `applySvg`）。JS 执行前（SSR 首屏）和 blob 生成失败时，老浏览器显示 fade。严格 CSP 的 SVG 降级需要 `img-src blob:`，`data:` 只剩 `Bone.image` 需要。`all.css` 从 25.2 KB 降到 11.7 KB（gzip 约 2.8 KB 降到 2.1 KB）。
- `skz-engine="svg"` 改为 blob 图真正挂上后才由 JS 写入（`applySvg` 返回是否挂上），不再由 `enable()` 直接写；没有 JS、JS 未执行或 blob 失败时根上没有该属性，自动落到基底 fade。
- `fallback` 选项收窄为 `"svg" | "fade"`（默认 `svg`），`enable()` 不再写 `skz-fallback` 属性；老浏览器的 solid / sweep 降级源码保留在 `_legacy-fallback.scss`，不打包。
- `syncExtensions` 分两遍：先撤掉未选中的扩展，再同步选中的，避免 `all` 里 `global` 在老浏览器上挂的 SVG 被 `svg` 扩展的 release 撤掉。
- 删除 `mode` 选项、`SkzMode` 类型和 `skz-mode` 属性：显式模式只能通过引入 `explicit.css`（和 `base.css` 二选一）使用；`base.css` 自动推导规则的根前缀为单写的 `[skz]`；`<skz-box>` 不再需要 `x-ske[loading]` 之类的元素特例选择器。
- 样式瘦身：tier0 圆角和 tier2 图标启发式用 `:is()` 收拢（构建时关闭 lightningcss 对 `:is()` 的展开）；tier1 不再按 22 个标签逐个撤销 tier0 背景，改用根上的 `--skz-tbg` / `--skz-timg` / `--skz-tradius` 变量开关。
- 包拆成"基底 + 变体"按需加载：基底 `skeletonizer/base.css`（自动推导）/ `skeletonizer/explicit.css`（只认 `skz-bone`，不含推导规则）二选一；变体 `skeletonizer/global`、`skeletonizer/svg`（JS 自带 CSS，另有 `/js` 纯 JS 入口和 `.css` 纯 CSS 入口）、`skeletonizer/sweep.css`；`skeletonizer/all` 一次全部引入（`style.css` 为 `all.css` 的别名）。核心 `skeletonizer` 不带 CSS。
- `engine` 取值改为 `"global"` / `"svg"`，不传时按已引入的变体决定；新增 `registerExtension` 供变体注册。
- global 方案在不支持 `@property` 的浏览器里默认降级为 SVG 动画（由 JS 挂 blob 图，`fallback` 为 `"svg"` 并作为默认）。
- 修复：忽略区（`skz-ignore`）自己没写颜色时，会从骨架父级继承到 `transparent`，第 0 档以上整段看不见。藏文字改用 `-webkit-text-fill-color: transparent`，不再动 `color`；忽略区把填充色重置为 `currentColor`，后代也保留自己的文字色（原"第 0、1 档忽略区后代颜色会丢"的限制随之消失，背景仍会被清掉）。代价：容器上依赖 `currentColor` 的边框 / outline / box-shadow 在骨架里会露出来。兜底层不变。
- 修复：基底里 pulse / shimmer 退回 fade 的规则优先级过高，会盖掉变体动画；改为 `:where()`。
- 首次发布：`enable`/`disable`、`<skz-box>`、`Bone` mock 工具、分档渐进增强的纯 CSS 骨架。
- 源码全部 TypeScript，JS 产物降级到 ES2015 并压缩，构建时产出 `.d.ts`；最低支持 CSS 变量的浏览器。
- 宿主骨架样式去掉 `inset`，改用 top/right/bottom/left，兼容 Safari < 14.1。
- 新增框架适配层：`skeletonizer/vue`（指令/组件/组合式/插件）、`skeletonizer/react`（Hook/组件）、`skeletonizer/svelte`（action）。
- `<skz-box>` 的类定义在非浏览器环境不再报错（SSR 安全）。
- `<skz-box>` 的开关是宿主自己的 `loading` 属性（属性存在且值不为 `"false"` 即开启，JS 属性 `loading` 读写同一个属性）；`enable` / `disable` / `toggle` 作用在【第一个元素子节点】上，宿主自己不带 `skz`，所以没有重入问题。宿主被移动（先断开再连接）后加载态自然恢复，不再泄漏 `inert`。不带 MutationObserver：子根被框架替换后由用户自己处理（例如切一下 `loading`）；SSR / 无 JS 时在子根上直接写 `skz`，如 `<skz-box loading><div skz>…</div></skz-box>`。
- 根标记从 class 改为属性 `skz`（`ROOT_CLASS` → `ROOT_ATTR`），框架整体改写 class 不再冲掉骨架，去掉了补回 class 的 MutationObserver。
- 懒渲染：根滚出视口时打上 `skz-paused` 并移除动画，全库共享一个 `IntersectionObserver`。
- `skz-ignore` 区在加载中保持可点击、可聚焦（`inert` 只锁不含忽略区的分支）。
- 重复调用 `enable()` 会清掉没传的 `effect` / `text`，关闭时一并移除。
- `registerCustomElements` 每次调用各持一张样式表，`dispose` 只清自己的；传 ShadowRoot 时样式表挂在该 ShadowRoot 上；标签没变不重写样式表。
- 随包附带 `llms.md`：给 AI 编码助手的精简用法与坑点清单；README 提供贴进项目 `AGENTS.md` / `CLAUDE.md` 的接入片段；公共 API 的类型注释补上前提与坑点。
- `pulse` / `shimmer` 改为根驱动：根上一个动画驱动 `@property` 注册的变量，骨头不再各挂动画；修复元素级写法下 `pulse` 与下划线模式 `shimmer` 被 `!important` 压住、看不出动画的问题。不支持 `@property` 的浏览器退回 `fade`，iOS 上 `shimmer` 改为颜色脉冲。
- 继承防火墙：css 方案的 `pulse` / `shimmer` 自动给视口外的列表项打 `skz-fw`、钉住动画变量，16000 元素 shimmer 从约 17 帧到 60 帧。
- SVG 方案改为运行时按主题生成 blob SVG：颜色与 `--skz-highlight` 一致、`--skz-duration` 生效、系统深浅色切换自动重新生成；无 JS 时退回 fade。
- 新增 `fit` 选项（`enable(el, { fit: true })` / `<skz-box fit>`）：骨架自身不撑出滚动条。根高度限制在最近滚动祖先（没有则视口）的剩余空间内，完全落在外面的列表项 `display: none`；收口后边界仍可滚（滚动条由别的内容造成，或骨架在首屏以下）时放宽为一屏高；尺寸变化自动重算。
- 新增显式基底 `skeletonizer/explicit.css`：只认 `skz-bone` / `skz-leaf`。
- **默认文字模式改为 `clip`**（`skz-text="clip"`，不写即是）：下划线当形状、`background-clip: text` 当填充，文字条里有 shimmer 光带，svg 引擎下文字也能动。要原来的纯下划线需显式写 `text: "underline"`（`skz-text="underline"`，最便宜）。**代价**（Chrome 154、16000 元素实测，见 `docs/reports/2026-10-09-benchmark-matrix.md` 补测一节）：fade / solid 没有变贵；shimmer 的 GPU 约 3 倍，svg 下 PrePaint 约 1.5 倍；4× CPU 降速下 svg shimmer 12.8 帧（underline 34.8）；**pulse + `global` + `enable()` 掉到约 24 帧**（underline 60 帧，疑似文字背景色变量绕过了继承防火墙，未验证）；直接写在 div 里的裸文字不出骨头。clip 规则整组无条件写在 `tier1`，浏览器不认 `background-clip: text` 时由 `@supports not` 撤回、退回 `underline`；装饰线参与裁剪仅 Chrome 实测过，Firefox / Safari 未验证（已知风险）。
- sweep 光带倾斜角改为变量 `--skz-sweep-skew`（默认 `-12deg`，`0deg` 为竖直）：倾斜绕根中心，根高超过约 16 倍根宽（手机 375px 宽约 5.9k px）时光带会被斜出视口，长根请设 `0deg` 或配合 `fit`。sweep 只有一种，按主题自动切换：浅色用 lighten 混合只提亮骨头；深色自动改用容器色扫光（光带色取 `--skz-sweep-bg-rgb`，默认 `31, 41, 55`，换主题时覆盖它），容器不漏光。不再有 `skz-sweep` 属性。
- 修复：带背景的 `<button>` 骨架化后只有文字是骨头、按钮外形（背景、圆角、内边距）丢失。原因：`button` 在文字类标签里，underline 模式根上把文字标签的背景变量置透明，clip 模式又把背景裁进字形。现把 `button` 当控件（与 `input` / `select` 同类）整块涂成一块骨头：内部的 span / 图标藏起来、自身和后代都不画下划线；自己写了 `border-radius` 的保留，没写的用 `--skz-radius`；`skz-ignore` 的按钮不受影响。
- 骨头圆角改用 `:where()` 零优先级，元素自己的 `border-radius`（如圆形头像）不再被盖掉。
- 新增 SVG 方案 `skz-engine="svg"` / `engine: "svg"`：骨头共用一张 SMIL 动画 SVG 背景，CSS 每帧不变，16000 元素下 shimmer 从 22 帧到 58 帧，且不依赖 `@property`。
- 新增降级目标 `fallback` 选项（`svg` / `fade`），产品可指定老浏览器里 `pulse` / `shimmer` 退回什么效果。
- 性能：根里含忽略区时 `enable()` 在根上加 `skz-has-ignore`，替代 `:has([skz-ignore])`；叶子规则改用 `:has(> *)`。16000 元素下动画每帧样式重算少约 22%~28%，隐式 fade 开启耗时从约 140ms 降到约 64ms。
- 新增 `skz-cv`：根的直接子元素加 `content-visibility: auto`，视口外子元素跳过渲染。
- 移除 `maxAnimated` 自动降级。
- `skz-ignore` 区不再被强制 `animation: none`，业务自己的动画（如加载转圈）照常运行。
- 命名统一加 `skz` 前缀：标签 `<skz-box>`（默认注册）、属性 `skz-ignore` / `skz-leaf` / `skz-bone` / `skz-effect` / `skz-text`、CSS 变量 `--skz-*`、动画 `skz-*`；JS 导出 `SkzBox` / `defineSkzBox` / `SkzEffect` 等；Vue/React 组件改名 `SkzBox`。
- **shimmer 光带默认降频到 24 次/秒**：重新引入变量 `--skz-shimmer-timing`（默认 `steps(36)`，对应默认 `--skz-duration: 1.5s`；`steps(18)` = 12 次/秒更省，`linear` 恢复逐帧平滑）。此前删它是因为只测了样式重算没收益；计算值不变的帧 Chrome 不重绘，2000 卡 clip 的 GPU 从 11.4 ms 降到约 2.8 ms（`bench/2026-10-09-clip-steps/`，复测见 `bench/2026-10-10-landing/`）。档数与 `--skz-duration` 绑定（24 次/秒 = 时长秒数 × 24，改时长要同步改档数），**只对 `global` 生效**（svg 引擎的 SMIL 没降频，实验显示 clip + svg 的 PrePaint 降不动）；单独的 `effect: "pulse"` 时间函数不变。
- **clip 下 shimmer 根不再挂 `skz-pulse-root`**：pulse 动画只改 `--skz-ul-fill`，clip 的装饰线是透明的，画面零差别，却让样式重算每帧白做（2000 卡 7.2 → 2.6 ms，实验数据）。只有需要 `--skz-ul-fill` 逐帧变化的 `text: "underline"` / `"tofu"`，以及 iOS 分支（`--skz-fill` 读 pulse 颜色）才挂 pulse，这些场景里的 pulse 动画也读 `--skz-shimmer-timing` 同步降频。
- **修复：pulse + clip 绕过继承防火墙**：clip 根上的 `--skz-tbg`（读 `--skz-fill`）展开成每帧变化的值继承给所有后代，防火墙没钉它，2000 卡 pulse + clip 只有约 22~28 帧、样式重算 28~37 ms。现在 clip 根不再用 `--skz-tbg` / `--skz-timg` 转发 `--skz-fill`（文字骨头直接回落读 `--skz-fill`），pulse 根上的 `--skz-ul-fill` 也只挂在 underline / tofu 根上，逐帧变化的继承变量减少，防火墙也不再需要为 clip 特判；iOS 分支的防火墙也补上 `--skz-fill`（同样会泄漏）。落地复测：2000 卡 pulse + clip 22.8 帧 / 33.7 ms → 60.4 帧 / 6.95 ms；global shimmer clip 的 GPU 10.44 → 3.05 ms（`bench/2026-10-10-landing/`）；4× CPU 降速下默认 `steps(36)` 没收益。
- **新增可选文字模式 `text: "tofu"`（`skz-text="tofu"`）与入口 `skeletonizer/tofu.css`**：文字元素换成自制的 1.5 KB 方块字体 `skz-tofu`（woff2 base64 内联），颜色脉冲，GPU 与 underline 同量级；`all.css` 含它，`base.css` 不含。`$clip` 排除 tofu 根，**没引 `tofu.css` 时退回 underline 外观**。严格 CSP 需放行 `font-src data:`，字体失败时真实文字以骨头色露出（不做 JS 回退）；换行用方块宽度排，可能与真实文字差一行；含行内 `skz-ignore` 的父元素退回 underline。字体由 `scripts/gen-tofu-font.py` 生成 `src/styles/_tofu-font.scss`（开发期工具，不进 npm 依赖）。`SkzTextMode` 加 `"tofu"`。
- 修复：`registerCustomElements` 给 Web Component 宿主铺的 `::before` 骨头只写了静态底色，pulse / shimmer 对宿主没有动画；现在画法与 `sk-bone` 一致（读 `--skz-fill` / `--skz-bg-img` / `--skz-bg-pos` 等继承变量），global（含降频）、svg 引擎、防火墙对宿主同样生效。
- 注释更正：`_global.scss` / `_svg.scss` / `enable.ts` 里"下划线文字没法渐变 / 无法贴图"等过期表述，`text` 选项补"不传 = clip"和四种取值。
