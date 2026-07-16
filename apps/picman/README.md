# @codejoo/picman

picman 在 Service Worker 里拦截大图请求(动图:GIF、APNG、动画 WebP、动画 AVIF;静图:PNG、JPEG),先给页面一张立即可用的占位图,再在后台把完整图片下载完,下载好了通知页面切换过去。小图和未识别格式一律直接放行,不受影响。

占位图分三段展示:先是一块从图片调色板取色的纯色/渐变色块,几乎瞬间出现;然后是一张静态预览(动图取首帧,静图按编码方式取全图模糊预览或降采样缩略图,见「静态大图也能渐进」一节);等全图下载完、且元素真正进入视口,才切成完整内容。整个过程不依赖任何解码库——首帧靠截断字节流重组出一张合法的单帧图片,再交给浏览器原生解码。切换时机严格控制在页面 LCP 之后,不与关键渲染路径抢资源。

另外还能顺带接管 `<video>`,先出封面、把视频推迟到要看时再下,专门用来降 LCP,见下面「顺带把视频封面也接管了」。

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

#### 顺带把视频封面也接管了

首屏那种自动播放的大视频最容易把 LCP 拖慢——浏览器一上来就闷头下载视频,和真正要先出现的内容抢带宽。picman 可以先给视频显示一张封面,把真正的视频推迟到用户要看的时候(自动播放的则推迟到首屏渲染完之后)再下载。默认关着,想用就打开:

```ts
auto({ videos: true });
```

打开后,页面里的 `<video>` 会被接管:先把它的 `src`、`autoplay`、`preload` 摘掉,别让浏览器抢跑;封面优先用你自己写的 `poster`(这条路最省,不多发一个请求);没写 `poster` 的话,先垫一块色块,然后在首屏空下来之后拉视频开头的一小段、抽出第一帧当封面。等用户把鼠标移上去、点一下,或者代码调用 `.play()`,才把真正的视频源装回去开始播。

自动播放的视频要的是"照样自动播,但别卡首屏":默认策略 `videoAutoplay: 'after-lcp'` 会等主线程在首屏渲染后空闲下来再放行播放,而不是死等 `load` 事件(那样重页面会迟迟不播);真需要立刻播就设成 `'immediate'`,想让自动播放的也必须等交互就设成 `false`。

有个前提要留意:想给没 `poster` 的视频抽真实首帧,视频得同源,或者跨域时服务端开了 CORS,否则画到 canvas 上会被判定跨域污染、拿不出图,这时会安静地留在色块封面。跨域的视频建议要么配好 CORS,要么干脆自己写个 `poster`,又快又稳。

| 视频相关选项         | 默认值        | 作用                                                           |
| -------------------- | ------------- | -------------------------------------------------------------- |
| `videos`             | `false`       | 是否接管 `<video>`,要显式打开                                  |
| `videoFrame`         | `true`        | 无 `poster` 时是否尝试抓真实首帧(关掉就只用色块)               |
| `videoRangeBytes`    | `262144`      | 抓首帧时拉取视频开头的字节数                                   |
| `videoAutoplay`      | `'after-lcp'` | 自动播放视频的放行时机:`'after-lcp'` / `'immediate'` / `false` |
| `videoAutoplayDelay` | `2000`        | `after-lcp` 等待首屏空闲的时间上限(毫秒)                       |

SW 那边还有个兜底开关 `deferVideos`,默认关。它能在 Service Worker 层面把没带播放标记的视频请求直接拦下、不下载,等页面还原真实源(带上播放标记)时才放行。只有当你确定每个受控页面都开了 `auto({ videos: true })` 时才适合打开它,否则那些没被接管的普通视频会被误拦而放不出来。

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
| `include`            | GIF/PNG/APNG/WebP/AVIF/JPEG 扩展名              | 哪些 URL 会被拦截判断                             |
| `exclude`            | `[]`                                            | 优先于 include 的排除规则                         |
| `colorBlock`         | `'gradient'`                                    | 色块样式,`'solid'` 或 `'gradient'`                |
| `fallbackColor`      | `'#e0e0e0'`                                     | 拿不到调色板颜色时的兜底色                        |
| `firstFrame`         | `'sharp'`                                       | 首帧占位样式,`'sharp'` 或 `'blur'`                |
| `blurRadius`         | `12`                                            | `firstFrame: 'blur'` 时的模糊半径(px)             |
| `headBytes`          | `4096`                                          | 嗅探格式前至少要读到的字节数                      |
| `firstFrameMaxBytes` | `524288`                                        | 首帧数据最多等多少字节,超过就放弃首帧档           |
| `staticProgressive`  | `true`                                          | 静态大图 PNG/JPEG 是否走渐进流程(见下节)          |
| `cache`              | `{ maxEntries: 200, maxAgeSeconds: 7 * 86400 }` | 全图缓存的条目数上限与过期时间                    |
| `onError`            | 空实现                                          | 任何阶段失败时的回调,拿到 `{ url, stage, error }` |

## 静态大图也能渐进,但编码方式决定体验上限

超过 `threshold` 的静态 PNG/JPEG 同样走"色块占位 → 缩略图 → 高清"三段,高清只在元素真正进入视口后才切换。缩略图从哪来,取决于图片的编码方式:

- **渐进式 JPEG(progressive)/ 隔行 PNG(Adam7 interlaced)**:整幅画面是交织编码的,首个 scan / 前几个 pass 一到就能解出**全图覆盖**的模糊/马赛克预览——picman 检测到这个结构信号后立刻把已到字节作为缩略图放出来,远早于下载完成。
- **baseline JPEG / 非隔行 PNG**:前面的字节只含顶部像素行,截断解码只有上面一条,不值得展示——picman 等全量下载完,在 Service Worker 线程里降采样光栅化一张缩略图(不占主线程)。

所以想要"下载到 10-20% 就看到全图模糊预览"的最佳体验,把大图转成渐进式编码即可,构建期一行配置的事:`mozjpeg -progressive`、`sharp().jpeg({ progressive: true })`、imgix 加 `fm=pjpg`,PNG 用 `-interlace Adam7`。不转也能用,只是缩略图要等下载完成。

另一个实践:如果某张图本身就是页面首屏的 LCP 主图(hero 图),任何形式的延迟展示对它都是感知负优化——用 `exclude` 把它排除掉,让它走浏览器原生的流式渐进渲染。

页面端 `auto()` 还支持 `offViewport` 选项,决定图片**离开**视口后显示什么:`'keep'`(默认,保持高清)、`'thumbnail'`(回退缩略图,浏览器得以释放大图解码内存)、`'placeholder'`(回退色块)。

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

`examples/` 下有个页面,演示了跨域 CDN 动图、同域 GIF、静态大图 PNG/JPEG 渐进、动画 WebP 与视频接管;不带 `--throttle` 默认不限速,带上则模拟慢网络,方便肉眼看到色块 → 静态预览 → 完整内容的切换过程。

## License

MIT
