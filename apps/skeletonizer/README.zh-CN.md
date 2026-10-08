# @codejoo/skeletonizer

> English docs: [README.md](./README.md)。

**Web 版骨架屏方案：照 Flutter skeletonizer 的路子，真实 DOM + mock 数据 + 纯 CSS，不用手画占位形状。**

受 Flutter 的 [skeletonizer](https://pub.dev/packages/skeletonizer) 启发，解决 vue-skeletor / react-content-loader 里手写占位的痛点 —— 改个 UI 就得重新设计骨架，特别折腾。这套方案照常渲染真实组件，喂进 mock 数据，由 CSS 根据实际布局自动生成骨头，需要例外的地方才标记。

## 怎么工作

三个部分组成：

1. **真实 DOM 渲染**：用你平常的 JSX / Vue 模板写组件，只是喂进 mock 数据而不是真实数据。
2. **Mock 数据**：用 `Bone` 工具生成文字、图片等占位内容，都是确定性的（SSR 友好，不用 `Math.random`）。
3. **CSS 自动命中**：根据标签名、元素内容、文本是否为空等启发式规则，自动把叶子替换成灰色骨头；也支持 `x-ske-bone` / `x-ske-leaf` / `x-ske-ignore` 裸属性来标记例外。

骨架样式是纯 CSS，分四层渐进增强（兜底 → Tier 0 → Tier 1 → Tier 2），从最老的浏览器到最新的都能用，不用 UA 嗅探，也不用 JS 闸门。

## 快速开始

### 1. 安装与引入

```bash
pnpm add @codejoo/skeletonizer
```

```js
import "skeletonizer/style.css"; // 合并后的全部样式（base + tier0~2 + effects）
import { enable, Bone } from "@codejoo/skeletonizer";
```

**兼容性**：最低支持 CSS 变量的浏览器（Chrome 49 / Firefox 52 / Safari 10 / Edge 15）。JS 产物已降级到 ES2015；`<x-ske>` 需要自定义元素 v1（Chrome 54 / Safari 10.1），不支持时自动跳过，改用 `enable()` 或纯 class 用法。

### 框架适配

适配层走子路径导出，框架本身是可选 peer 依赖，不用的话不会被引入。

```ts
// Vue 3：指令 / 组件 / 组合式
import { vSkeleton, XSke, useSkeleton, XSkePlugin } from "@codejoo/skeletonizer/vue";
// <div v-skeleton="loading">…</div>   或   <div v-skeleton="{ loading, effect: 'pulse' }">…</div>
// <XSke :loading="loading" effect="pulse">…</XSke>

// React：Hook / 组件
import { XSke, useSkeleton } from "@codejoo/skeletonizer/react";
// <XSke loading={loading} effect="pulse">…</XSke>
// const ref = useRef(null); useSkeleton(ref, loading); <div ref={ref}>…</div>

// Svelte：action
import { skeleton } from "@codejoo/skeletonizer/svelte";
// <div use:skeleton={{ loading, effect: 'pulse' }}>…</div>
```

SSR 安全：在 Node 里 import 整个包不会报错，骨架态只在浏览器端开启。

### 2. JavaScript 启用骨架

给容器元素开启骨架加载态：

```js
import { enable, disable } from "@codejoo/skeletonizer";

const cardEl = document.querySelector("#card");
const off = enable(cardEl, { effect: "fade", text: "underline" });

// 数据到了，关掉骨架
off();
// 或者用 disable(cardEl)
```

**`enable()` 的参数：**

- `effect`：动画效果，可选 `'fade'`（根级淡入淡出，默认）、`'solid'`（静止）、`'pulse'`（闪烁）、`'shimmer'`（流光）；后两个是元素级动画，元素多于 `maxAnimated`（默认 300）会自动降成 `fade`
- `text`：文字骨头模式，可选 `'underline'`（下划线，默认）、`'leaf'`（背景色块）

### 3. 使用 `<x-ske>` 自定义元素

HTML 里直接用，更声明式：

```html
<x-ske loading effect="pulse">
  <div class="card">
    <img src="..." alt="" />
    <h3>用户昵称</h3>
    <p>这是一段描述</p>
  </div>
</x-ske>

<script type="module">
  import { defineXSke } from "@codejoo/skeletonizer";
  defineXSke();
</script>
```

属性：

- `loading`：布尔，决定是否显示骨架（`<x-ske loading>` 打开，移除 `loading` 属性关闭）
- `effect`：同上（`fade` / `solid` / `pulse` / `shimmer`）
- `text`：同上（`underline` / `leaf`）

### 4. 纯 HTML / SSR 用法

不用 JavaScript，仅靠 class + 属性，CSS 一样工作：

```html
<div class="x-ske" x-ske-effect="pulse" x-ske-text="underline">
  <div class="card">
    <img src="..." alt="" />
    <h3>用户昵称</h3>
    <p>这是一段描述</p>
  </div>
</div>
```

### 5. 生成 Mock 数据

```js
import { Bone } from "@codejoo/skeletonizer";

const user = {
  name: Bone.text(8), // 8 个字符的占位文本："███ ██"
  bio: Bone.lines(3), // 大约 3 行的占位段落
  avatar: Bone.image(48), // 48×48 透明占位图（data URI）
};

// 直接放进你的真实渲染流程
const html = `
  <div class="card">
    <img src="${user.avatar}" alt="">
    <h3>${user.name}</h3>
    <p>${user.bio}</p>
  </div>
`;
```

## 标记词汇表

默认情况下，skeletonizer 自动命中叶子元素并替换成骨头。如果需要例外，用这三个属性标记：

| 属性           | 含义                                               | 例子                                                                         |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `x-ske-bone`   | 强制本元素当骨头（用于纯装饰元素，比如背景渐变条） | `<div x-ske-bone style="height:40px;background:linear-gradient(...)"></div>` |
| `x-ske-leaf`   | 整块合并成一个骨头（多个子元素打包成一个矩形）     | `<div x-ske-leaf><b>订单</b><br><span>待处理</span></div>`                   |
| `x-ske-ignore` | 保持原样，不变成骨头                               | `<div x-ske-ignore>保留真实色彩的 Logo</div>`                                |

**根元素上的属性：**

- `x-ske-effect="fade|solid|pulse|shimmer"`：动画效果（默认 fade）
- `x-ske-text="underline|leaf"`：文字骨头模式

## Bone 工具

`Bone` 类提供静态方法来生成占位数据，所有结果都是确定性的（不用 `Math.random`），SSR 时同样的输入永远得到同样的输出，天然支持水合。

### 文字占位

```js
Bone.text(n, { seed });
```

生成 n 个字符的占位文本，词与词之间用空格，可以自然换行。`seed` 参数用来改变词长分布（默认 0）。

```js
Bone.text(12); // "███ ████ ███"（词长为示意）
Bone.text(30, { seed: 1 }); // 相同的 seed 永远得到相同的分布
```

### 段落占位

```js
Bone.lines(k, { perLine, seed });
```

生成大约 k 行的占位段落。`perLine` 是每行预估字符数（默认 40）。

```js
Bone.lines(3); // 120 个字符（3 × 40）的占位文本
Bone.lines(3, { perLine: 30 }); // 90 个字符
```

### 中日韩文本占位

```js
Bone.cjk(n, { seed });
```

生成中日韩文本的占位串：纯方块，每隔 3~6 个字符放一个零宽空格用于断行。

```js
Bone.cjk(20); // 20 个方块，带合理的断点
```

### 数字占位

```js
Bone.number(digits);
```

生成固定位数的数字占位（全宽方块）。

```js
Bone.number(4); // "████"（4 位）
Bone.number(); // "███"（默认 3 位）
```

### 图片占位

`Bone.image(w?, h?)` 按参数个数走三种形态：

```js
Bone.image(); // 不传：1×1 透明 GIF 的 base64 data URI，兼容性最好
Bone.image(48); // 只传 w：h 默认等于 w，48×48 的方形透明 SVG
Bone.image(160, 100); // 传 w、h：160×100 的透明 SVG，带固有宽高比
```

- **不传参**：GIF 没有固有宽高，要用 `width` / `height` 属性或 CSS 指定尺寸，否则会塌成 1px。
  `<img :src="Bone.image()" width="160" height="100" />`
- **传尺寸**：SVG 自带宽高比，不容易引起布局跳动，头像、图标用 `Bone.image(48)` 最顺手。
- 参数非法（0、负数）会退回 1px GIF。

**注意：** 严格 CSP 若不放行 `img-src data:`，请改用自托管的透明图。

## 主题与效果

### 动画效果

五种内置效果，根元素上用 `x-ske-effect` 属性指定：

- **`fade`**（默认，不写 `x-ske-effect` 就是它）：根整体做 opacity 脉冲，跑在合成器线程，几乎零成本，元素再多也不卡
- **`solid`**：静止，没有动画
- **`sweep`**（原型，未定稿）：整个根一个扫光条，`transform` 平移、成本低。浅色下效果好，深色下会轻微漏到中间调的容器背景，根会被设成 `position: relative` 并占用根的 `::after`，详见[性能报告 §5](docs/reports/2026-10-08-performance.md)
- **`pulse`**：每个骨头元素各自闪烁。**元素级动画，贵**
- **`shimmer`**：流光从左到右扫过。**元素级动画，贵**

```html
<div class="x-ske" x-ske-effect="solid">...</div>
```

**性能提醒：** 实测 4000 个元素时，默认 `fade` 每帧约 16.5ms，`pulse` 约 255ms（约 4 帧/秒）。所以 `pulse` / `shimmer` 只适合小骨架；通过 `enable()` 或 `<x-ske>` 开启时，根下元素超过 300 个会自动降成 `fade`（`enable(el, { maxAnimated })` 可调）。纯 HTML 里直接写属性不受这个保护。详见[性能报告](docs/reports/2026-10-08-performance.md)。

默认的 `fade` 会把根里的所有内容一起淡掉，所以根里含 `x-ske-ignore` 时默认不开 fade（想开就显式写 `x-ske-effect="fade"`）。

### 文字骨头模式

两种方式来显示文字占位：

- **`underline`**（默认，Tier 1）：下划线法，在真实文字下面画一条线，粗度 `1em`、偏移 `-0.85em`。沿真实文字行延伸，最后一行自然变短，混合文字（`价格：<b>¥5</b>`）也覆盖。代价是不能渐变，没有 shimmer，只能 fade / pulse / solid。

- **`leaf`**（Tier 2，需 `:has()` 支持）：叶子背景法，给叶子元素背景色。可以 shimmer，有圆角。代价是多行块级文字会变成一整块矩形，混合文字里的裸文字节点既不出骨头也被藏起来。

```html
<!-- 下划线法 -->
<div class="x-ske" x-ske-text="underline">...</div>

<!-- 叶子背景法 -->
<div class="x-ske" x-ske-text="leaf">...</div>
```

### 深色模式

自动检测 `prefers-color-scheme: dark`，骨头色自动调浅。也可以手动设置 `data-x-ske-theme="dark"` 属性：

```html
<html data-x-ske-theme="dark">
  ...
</html>
```

### 自定义颜色

用 CSS 变量覆盖默认颜色（骨头色）和圆角：

```css
:root {
  --x-ske-color: #e0e0e0; /* 骨头灰色（默认 #d9dde3） */
  --x-ske-radius: 6px; /* 圆角（默认 4px） */
  --x-ske-ul-thickness: 1em; /* 下划线粗度（默认 1em） */
  --x-ske-ul-offset: -0.85em; /* 下划线偏移（默认 -0.85em） */
}
```

### 禁用动画

尊重 `prefers-reduced-motion: reduce`，自动停止动画：

```css
@media (prefers-reduced-motion: reduce) {
  /* 动画自动停止，无需手动设置 */
}
```

## 浏览器支持

skeletonizer 采用渐进增强策略，分四层 CSS 从老到新。每层都是向后兼容的：

| 浏览器能力                      | 档位   | 包含的样式表                | 效果描述                                                                                                                         |
| ------------------------------- | ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **无**                          | 兜底   | `base.css`                  | 整块灰色。根的直接子元素各一块背景，后代 `visibility:hidden`。不要求任何 CSS 特性，IE 也能用（只是完全禁用了 shadow DOM 的宿主） |
| **CSS 变量（默认支持）**        | Tier 0 | `+ tier0.css + effects.css` | 标签白名单（`p` / `h1`-`h6` / `li` 等）白底、图标灰色。动画效果启用                                                              |
| **`text-decoration-thickness`** | Tier 1 | `+ tier1.css`               | 下划线法文字骨头。每行真实贴合，混合文字也覆盖                                                                                   |
| **`:has()` 选择器**             | Tier 2 | `+ tier2.css`               | 叶子背景法文字骨头、细粒度图标识别（以内容推断而非类名）、`x-ske-ignore` 祖先修正                                                |

**@supports 条件表：**

```css
/* Tier 0 起：默认浏览器支持 CSS 变量，不做 @supports 判断 */

/* Tier 1 起 */
@supports (text-decoration-thickness: 1em) {
  /* text-decoration-thickness */
}

/* Tier 2 起 */
@supports selector(:has(*)) {
  /* :has() 伪类 */
}
```

**标注说明：**

- **Tier 0 / 1**：标注 `best effort`，只在桌面 Chrome 验证过（见下方）。Safari / Firefox / iOS / Android 等浏览器的行为需要实测验证。
- **Tier 2**：同样 `best effort`；需要 `:has()` 支持，2024 年后的浏览器较好支持。
- **旧浏览器未实测**：兜底层应该工作，但没在 IE / Firefox ESR 等环境真机验证过。

**当前验证状态：**

- ✅ 桌面 Chrome（DevTools 协议驱动）：Tier 0~2 完整验证，见 [原型验证报告](docs/reports/2026-10-08-prototype-verification.md)
- ❓ Safari、Firefox、iOS Safari、Android WebView、旧浏览器：**未验证**
- ❓ iOS 上 `background-attachment: fixed`：设计层已按降级处理，实际需要上真机验证

## 已知限制与使用约束

### 兜底层的边界情况

这些是兜底层（仅 `base.css`）的限制，Tier 0 以上可能部分改善或完全解决：

1. **`video` / `canvas` / `iframe` 作根的直接子元素**：真实内容仍会盖在灰块上。解决方案：自己包一层 `div`。

   ```html
   <!-- ❌ 不行 -->
   <div class="x-ske">
     <video width="160" height="100"></video>
   </div>

   <!-- ✅ 要这样 -->
   <div class="x-ske">
     <div><video width="160" height="100"></video></div>
   </div>
   ```

2. **`display: contents` 包装**：没有盒子涂不上色，后代又被 `visibility:hidden` 藏起来，那块会变成**空白**。

   ```html
   <!-- ❌ 不行 -->
   <div class="x-ske">
     <div style="display:contents">
       <p>段落一</p>
       <p>段落二</p>
     </div>
   </div>

   <!-- ✅ 用普通 div 包装 -->
   <div class="x-ske">
     <div>
       <p>段落一</p>
       <p>段落二</p>
     </div>
   </div>
   ```

3. **裸文字**：直接放在根下的裸文字节点不会被藏起来，会露出真实文字。

   ```html
   <!-- ❌ 不行 -->
   <div class="x-ske">这是裸文字，会露出来</div>

   <!-- ✅ 用 span 或其他元素包住 -->
   <div class="x-ske">
     <p>这是段落，会被处理</p>
   </div>
   ```

4. **绝对定位的悬浮角标**：会被涂成一块灰。需要保持原样就标 `x-ske-ignore`。

   ```html
   <div class="x-ske" style="position:relative;">
     <span class="badge" x-ske-ignore style="position:absolute;right:0;top:0;">new</span>
     <div>卡片内容</div>
   </div>
   ```

5. **icon-font 星标**（Tier 0）：icon-font 的字形会露出来。Tier 2 有启发式规则识别图标，改善这个问题。

### `x-ske-ignore` 区的颜色污染（Tier 0 / 1）

`x-ske-ignore` 标记的区域及其后代的自带颜色 / 背景，在 Tier 0、1 会被 `color: inherit` 覆盖，导致丢失。Tier 2 的 `:has()` 规则才能精确保留。如果需要在 Tier 0 / 1 保留颜色，需要显式标记这些元素的字体颜色。

### Web Component 宿主

Web Component 宿主（Shadow DOM）的处理：需要调用 `registerCustomElements()` 才能生成宿主样式表。

```js
import { registerCustomElements } from "@codejoo/skeletonizer";

// 生成宿主样式表（adoptedStyleSheets 或降级 <style>）
const { refresh, dispose } = registerCustomElements(document, { watch: true });
// 如果后来新增了自定义元素，调用 refresh() 重扫
refresh();
```

宿主会被 `visibility:hidden` + `::before` 伪元素铺骨头，宿主自己的背景色也会被 `visibility` 藏掉。

### `inert` 属性支持

`enable()` 默认用原生 `inert` 锁定交互。不支持 `inert` 的浏览器会降级到 CSS `pointer-events:none` + `focusin` 事件拦截，但该降级分支未在真机验证过。

## 在框架里怎么用

skeletonizer 是标准 Web Component / ESM，各框架的集成都很简洁，不需要额外的适配包。

### Vue 3

用 `isCustomElement` 让 Vue 不去处理 `x-ske` 标签：

```js
// vite.config.js / vue.config.js
export default {
  // Vite
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'x-ske',
        },
      }),
    }),
  ],
  // 或 Vue CLI
  chainWebpack: (config) => {
    config.module
      .rule('vue')
      .use('vue-loader')
      .loader('vue-loader')
      .tap((opts) => ({
        ...opts,
        compilerOptions: {
          isCustomElement: (tag) => tag === 'x-ske',
        },
      }));
  },
};
```

在模板里直接用：

```vue
<template>
  <x-ske :loading="isLoading" effect="pulse">
    <div class="card">
      <h3>{{ user.name }}</h3>
      <p>{{ user.bio }}</p>
    </div>
  </x-ske>
</template>

<script setup>
import { defineXSke } from "@codejoo/skeletonizer";

defineXSke();

const isLoading = ref(true);
const user = ref({ name: "", bio: "" });

onMounted(async () => {
  const data = await fetchUser();
  user.value = data;
  isLoading.value = false;
});
</script>
```

### React 18+

React 18 原生支持自定义元素属性为字符串，直接用：

```jsx
import { defineXSke } from "@codejoo/skeletonizer";

defineXSke();

export function CardSkeleton({ isLoading, user }) {
  return (
    <x-ske loading={isLoading} effect="pulse" text="underline">
      <div className="card">
        <h3>{user.name}</h3>
        <p>{user.bio}</p>
      </div>
    </x-ske>
  );
}
```

如果在 React 17 或需要更细的控制，用 `enable()` / `disable()`：

```jsx
import { useEffect, useRef } from "react";
import { enable, disable } from "@codejoo/skeletonizer";

export function CardSkeleton({ isLoading, user }) {
  const ref = useRef(null);

  useEffect(() => {
    if (isLoading) {
      const off = enable(ref.current, { effect: "pulse" });
      return () => off();
    } else {
      disable(ref.current);
    }
  }, [isLoading]);

  return (
    <div ref={ref} className={isLoading ? "x-ske" : ""}>
      <div className="card">
        <h3>{user.name}</h3>
        <p>{user.bio}</p>
      </div>
    </div>
  );
}
```

### Svelte

Svelte 直接支持自定义元素：

```svelte
<script>
  import { defineXSke } from '@codejoo/skeletonizer';
  import { onMount } from 'svelte';

  defineXSke();

  let isLoading = true;
  let user = { name: '', bio: '' };

  onMount(async () => {
    user = await fetchUser();
    isLoading = false;
  });
</script>

<x-ske loading={isLoading} effect="pulse" text="underline">
  <div class="card">
    <h3>{user.name}</h3>
    <p>{user.bio}</p>
  </div>
</x-ske>
```

或用指令 `use:enable`：

```svelte
<script>
  import { enable, disable } from '@codejoo/skeletonizer';

  let isLoading = true;

  function enableSkeleton(node) {
    if (isLoading) {
      const off = enable(node, { effect: 'pulse' });
      return { destroy: off };
    }
  }
</script>

<div use:enableSkeleton class={isLoading ? 'x-ske' : ''}>
  <div class="card"><!-- 内容 --></div>
</div>
```

## 本地运行 demo 与测试

### 构建 CSS

```sh
npm run build
```

用 `vp pack`（tsdown）把 `src/` 打成 ES2015 的 `dist/*.mjs` 并生成 `dist/*.d.mts`，同时把 `src/styles/skeletonizer.scss` 编译压缩成 `dist/skeletonizer.css`（CSS 处理依赖 `@tsdown/css`）。开发时 `pnpm dev` 打开 demo 热更新。类型检查和 lint：`pnpm check`。

### 启动 demo 服务器

```sh
# 方式一：用 Python（仓库根目录）
python -m http.server 5188

# 方式二：用 Node 的 http-server（需安装）
npx http-server -p 5188
```

打开 http://127.0.0.1:5188/demo/index.html，可以实时切换效果、档位、文字骨头模式。

### 运行测试

```sh
npm test
```

用 Node.js 的原生 `node:test` 运行 `test/*.test.ts`（Node 24 直接跑 TS，无需转译） 里的单元测试。主要测试 `Bone` 数据生成和 `enable()` 基本功能。

## 路线图

**短期（v0.2~v0.3）：**

- [ ] TypeScript 化，用 `tsup` 构建（JS 目标 ES2015）
- [ ] CSS 接 PostCSS + autoprefixer（确认依赖后）
- [ ] Playwright 三引擎视觉快照回归测试（Chrome / Firefox / Safari）

**中期（v0.4~v0.5）：**

- [ ] 框架使用示例文档：Vue 指令完整示例、React hooks 封装、Solid 例子
- [ ] 补真机验证：iOS Safari（`fixed` 背景、`inert`、`::before` 宿主）、Firefox、Firefox ESR、Safari
- [ ] 评估运行时测量模式（`Range.getClientRects` 覆盖层）作为精确模式的逃生口

**发布前：**

- [ ] 确认 npm 包名 `skeletonizer` 仍未被占用
- [ ] 完整的浏览器兼容性表（各档位验证结果、旧浏览器已知问题）
- [ ] 迁入到单独的 npm 包（现在还是 workspace）

**已知未验证项：**

- Safari / Firefox / iOS / Android WebView
- 真实 `video` / `iframe` 的处理
- `inert` 缺失时的降级分支（CSS `pointer-events` + `focusin`）
- `registerCustomElements` 的 `<style>` 降级分支（Chrome 走 `adoptedStyleSheets`）
- iOS 上 `background-attachment: fixed` 是否真的需要降级为 `pulse`
- 深色模式下的视觉效果（只在浅色下实测过）

## 文档与参考

- **[设计总结](docs/design/overview.md)**：已定决策表、四档层叠详解、标记词汇、API 定义、后续路线
- **[原型验证报告（桌面 Chrome）](docs/reports/2026-10-08-prototype-verification.md)**：实测各假设是否成立、最终参数、未验证项清单
- **[当前状态与待办](docs/status.md)**：做到哪、没做什么、怎么跑 demo
- **[文档索引](docs/README.md)**：术语解释

## License

当前是原型阶段，许可证待定。

## 致谢

设计灵感来自 Flutter 的 [skeletonizer](https://pub.dev/packages/skeletonizer)、[vue-skeletor](https://www.npmjs.com/package/vue-skeletor) 的占位思路，以及实战中对"改个 UI 就得重画骨架"这一痛点的反思。
