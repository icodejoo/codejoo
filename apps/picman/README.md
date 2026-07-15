# @codejoo/picman

picman 在 Service Worker 里拦截动图请求(GIF、APNG、动画 WebP),先给页面一张立即可用的占位图,再在后台把完整动图下载完,下载好了通知页面切换过去。小图和非动图一律直接放行,不受影响。

占位图分三段展示:先是一块从图片调色板取色的纯色/渐变色块,几乎瞬间出现;等首帧数据下载到一定比例,换成一张清晰(或模糊,可配)的静态首帧;等全图下载完,页面收到通知切成完整动画,从头播放。整个过程不依赖任何解码库——首帧是靠截断字节流重组出一张合法的单帧图片,再交给浏览器原生解码。

v1 只处理动图。静图(JPEG/PNG/WebP/AVIF)的渐进加载已经设计过,但还没实现,详见 `docs/REQUIREMENTS.md`。

## 安装

```bash
pnpm add @codejoo/picman
```

## 接入方式

picman 提供三种接入方式,选一种就够,也可以混用。

### 方式一:零改造接管

页面上的 `<img>` 该怎么写还怎么写,picman 用 MutationObserver 接管既有和后续插入的图片元素:

```ts
import { auto, registerPicmanSW } from "@codejoo/picman";

await registerPicmanSW("/picman-sw.js");
const stop = auto();
```

背景图想一起接管,给元素加个 `data-picman-bg` 属性(值是图片 URL),CSS 里正常写 `background-image`:

```html
<div data-picman-bg="/banner.gif" style="background-size: cover"></div>
```

v1 只支持这种显式标记,不会去扫样式表找背景图 URL。

### 方式二:显式 API

不想要自动接管,可以自己控制何时切换:

```ts
import { load } from "@codejoo/picman";

const task = load("/big.gif").onStage((stage, displayUrl) => {
  img.src = displayUrl; // stage: 'placeholder' | 'first-frame' | 'complete'
});
await task.done; // resolves with the full-image URL, rejects on download failure
```

### 方式三:Web Component

```html
<script type="module">
  import "@codejoo/picman/element";
</script>
<pic-man src="/big.gif" alt="a big gif"></pic-man>
```

内部就是套了一层 `load()`,渲染在 shadow DOM 里的 `<img>` 上。

## Service Worker 怎么装

两种方式都行,选哪种取决于你的部署方式。

**直接用预构建成品**(不需要自己维护 SW 文件):

```ts
import { registerPicmanSW } from "@codejoo/picman";
await registerPicmanSW("/picman-sw.js"); // 把 dist 里的 picman-sw.js 部署到站点根目录
```

**自己的 SW 里引入**(你已经有 service worker 在做别的事):

```ts
// 你自己的 sw.ts
import { setupPicman } from "@codejoo/picman/sw";
setupPicman({ threshold: 200 * 1024 });
```

## 配置

`setupPicman(options)` 支持的选项都有默认值,一般不需要动:

| 选项                 | 默认值                                          | 作用                                              |
| -------------------- | ----------------------------------------------- | ------------------------------------------------- |
| `threshold`          | `102400`(100KB)                                 | 小于这个字节数直接放行,不走渐进流程               |
| `include`            | GIF/PNG/APNG/WebP 扩展名                        | 哪些 URL 会被拦截判断                             |
| `exclude`            | `[]`                                            | 优先于 include 的排除规则                         |
| `colorBlock`         | `'gradient'`                                    | 色块样式,`'solid'` 或 `'gradient'`                |
| `fallbackColor`      | `'#e0e0e0'`                                     | 拿不到调色板颜色时的兜底色                        |
| `firstFrame`         | `'sharp'`                                       | 首帧占位样式,`'sharp'` 或 `'blur'`                |
| `blurRadius`         | `12`                                            | `firstFrame: 'blur'` 时的模糊半径(px)             |
| `headBytes`          | `4096`                                          | 嗅探格式前至少要读到的字节数                      |
| `firstFrameMaxBytes` | `524288`                                        | 首帧数据最多等多少字节,超过就放弃首帧档           |
| `cache`              | `{ maxEntries: 200, maxAgeSeconds: 7 * 86400 }` | 全图缓存的条目数上限与过期时间                    |
| `onError`            | 空实现                                          | 任何阶段失败时的回调,拿到 `{ url, stage, error }` |

## 出错了会怎样

picman 的原则是任何一层出问题都退回到原图正常加载,不会让页面看起来比不用它更差:

- Service Worker 没注册、被浏览器禁用、或者环境不支持:`load()` 直接返回原图 URL,`auto()` 什么都不做。
- 识别出不是动图,或者格式嗅探失败:直接透传原始响应。
- 浏览器不支持 `OffscreenCanvas`:跳过首帧这一档,色块直接跳到完整动画。
- 首帧重组失败:停在色块档,不影响后台下载和最终切换,`onError` 会收到通知。
- 下载中途断开:通知页面失败,`auto()` 会给对应元素加个重试标记直接走网络。

## 浏览器要求

依赖 Service Worker、Cache Storage、`ReadableStream`,以及可选的 `OffscreenCanvas`/`createImageBitmap`(缺了会跳过首帧档,不影响其他部分)。基本上是近几年的 Chrome/Edge/Firefox/Safari 都能跑,老浏览器会自然降级成直接加载原图。

## 本地跑一下 demo

```bash
pnpm build
node --experimental-strip-types examples/serve.ts --throttle 51200
```

`examples/` 下有个页面,同时演示了三种接入方式,`--throttle` 用来模拟慢网络,方便肉眼看到色块 → 静态首帧 → 完整动画的切换过程。跑之前记得往 `examples/big.gif` 放一张体积够大的动图。

## License

MIT
