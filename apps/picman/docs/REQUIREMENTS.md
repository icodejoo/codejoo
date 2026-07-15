# @codejoo/picman 需求现状

> 最后更新:2026-07-16(对应 [docs/logs/2026-07-16-1.md](logs/2026-07-16-1.md))

## 一句话定位

利用 Service Worker 拦截图片请求的渐进加载库:小图直接放行;大图先抽出关键信息立即合成占位图交给页面显示,后台继续下载全图,完成后通知页面切换成清晰图。

**v1 范围聚焦动图(GIF / APNG / 动画 WebP)**:嗅探为非动图的请求一律透传;静图(JPEG/PNG/WebP/AVIF)的渐进方案已脑暴但延后实施(见 log 2026-07-15-2 附录)。

## 核心数据流(v1,动图)

```
<img src="big.gif">
  → SW fetch 拦截
  → URL 规则粗筛(不命中 → 透传)
  → 发真实请求,看 Content-Length
      ├─ < 阈值(默认 100KB)→ 透传
      ├─ ≥ 阈值 → 进入嗅探
      └─ 无 Content-Length → 边读响应流边计字节:
           累计超阈值 → 进入嗅探(已缓冲字节续用,不重发请求)
           读完仍未超 → 整体透传当小图
  → 格式嗅探(魔数):GIF87a/GIF89a、PNG+acTL chunk、RIFF+VP8X 动画位
      非动图 → 透传(v1 只处理动图)
  → 渐进流程(三段占位时间轴):
      1. 头部字节 → 宽高 + 调色板颜色(有则取)→ SVG 色块占位立即响应
         (solid 纯色 / gradient 双色渐变,可配,默认 gradient;无颜色信息用默认灰,可配)
      2. 后台续下,首帧数据块收齐 → 截断重组成合法静态单帧文件
         → createImageBitmap 解码 → OffscreenCanvas 出静态首帧占位
         (sharp 清晰 / blur 模糊,可配,默认 sharp)→ 通知页面升级占位
      3. 全图下载完 → 写入 Cache Storage(LRU)→ postMessage 通知页面
  → 页面收到通知切换 → 动画从头开播(方式取决于接入模式,见下)
```

### 首帧截断重组(核心技巧,零解码器)

| 格式      | 重组方式                                                      | 档位                  |
| --------- | ------------------------------------------------------------- | --------------------- |
| GIF       | 块结构走到首帧图像块收齐,拼 `0x3B` trailer = 合法单帧 GIF     | 稳定                  |
| APNG      | chunk 结构走到首帧 IDAT 收齐,补 IEND chunk = 合法静态 PNG     | 稳定                  |
| 动画 WebP | 取首个 ANMF 内 VP8/VP8L 数据重打包静态 WebP(需改 VP8X 标志位) | 尝试性,失败停留色块档 |

块边界只靠长度字段遍历,不解码内容;重组产物交浏览器原生解码。

## 已确认的需求决策

### 1. 交付形态:传输无关核心 + 可插拔适配器

一个核心引擎(字节流 → 关键信息 → 占位 → 续下 → 通知),与「谁在拦截请求」解耦。三种装配方式全部支持:

- **SW 自装模式**:用户在自己的 sw.ts 里 `import { setupPicman } from '@codejoo/picman/sw'`。
- **SW 托管模式**:库发布预构建成品 `dist/picman-sw.js`,用户部署到站点根目录直接注册,页面端提供 `registerPicmanSW(swUrl)` 辅助。
- **页面 fetch 适配器**:不依赖 SW,页面内 `fetch` + `ReadableStream` 边下边解,同一核心引擎复用。

### 2. 占位图:三段时间轴 + 两个样式开关

时间轴固定:`色块(毫秒级)→ 静态首帧(下载百分之几时)→ 动画开播(全图完)`。样式开关:

- `colorBlock: 'solid' | 'gradient'`(默认 gradient)——色块纯色或双色纵向微渐变;颜色来自调色板(GIF 全局调色板/APNG PLTE,取平均或明暗两端),拿不到时用默认色(可配,默认浅灰)。色块用 SVG 文本合成,零 canvas 依赖。
- `firstFrame: 'sharp' | 'blur'`(默认 sharp)——首帧占位清晰(Twitter 封面式)或模糊化。

### 3. 页面接入:三种全要,分层实现

B 是底座,A、C 都建在 B 上:

- **A. 零改造接管**:`auto()`。业务 `<img src>` 原样写;MutationObserver 接管 `<img>` 与 CSS 背景图;收到 SW 阶段通知后,对匹配元素直接把 `src`/`backgroundImage` 换成带阶段参数的 URL(二次请求命中 SW 缓存秒回)。**v1 实现范围**:背景图仅支持显式 `data-picman-bg="<url>"` 标记(不扫样式表);`<img>` 仅接管 `src` 属性,`srcset`/`<picture>` 留待后续版本(见 [docs/logs/2026-07-16-1.md](logs/2026-07-16-1.md))。
- **B. 显式 API**:`picman.load(url)` → 占位 URL + 完成 Promise/事件(`onPlaceholder` / `done`),业务自己控制何时换 src。
- **C. Web Component**:`<pic-man src>`,原生 Custom Elements 实现,内部用 B,保持框架无关。

### 4. 大小图判定:URL 规则粗筛 + Content-Length 细判 + 格式嗅探

- 先过用户配置的 include/exclude 规则(路径/扩展名/CDN 参数),不命中直接放行。
- 命中后看 Content-Length,阈值默认 100KB,可配。
- **无 Content-Length 时不放弃**:继续读响应流并计字节,超阈值即进嗅探(已缓冲字节续用),读完没超则整体透传。
- 超阈值后嗅探魔数,**非动图透传**(v1);动图才进渐进流程。

### 5. 全图缓存:Cache Storage + LRU

下载完写入 `caches`,SW 重启不丢。可配 `maxEntries`(默认 200)/ `maxAgeSeconds`(默认 7 天),超限 LRU 淘汰。

### 6. 错误处理与降级

原则:任何一层失败都塌向「原图正常加载」,库只增强、不劣化。

| 故障点                                 | 处理                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| SW 不可用(未注册/隐私模式/不支持)      | `load` 退化为直接返回原 URL、`done` 立即 resolve;`auto()` 静默 no-op;`<pic-man>` 渲染裸 `<img>` |
| 嗅探非动图/嗅探失败                    | 透传                                                                                            |
| OffscreenCanvas 不可用                 | 色块本就是 SVG 不受影响;跳过首帧档,色块直达全图                                                 |
| 首帧重组失败(createImageBitmap reject) | 停留色块档,不影响后台下载与最终切换,`onError` 上报                                              |
| 后台下载中途断                         | 通知页面失败;A/C 模式对元素重设原 URL + 重试标记(SW 见标记透传);B 模式 `done` reject            |
| 完成通知丢失(SW 被杀/竞态)             | 兜底对账:占位响应带标记头,运行时跟踪占位中元素,`visibilitychange`/惰性查 `caches.match` 补切换  |
| `cache.put` 配额失败                   | LRU 驱逐重试一次;再败放弃落盘仍发通知,二次请求走网络流                                          |
| 同 URL 并发多元素                      | SW 内按 URL 去重 in-flight 下载                                                                 |
| 元素中途移除                           | 下载继续(进缓存),不取消                                                                         |

配置钩子:`onError(ctx)`(SW 端与页面端各一)。

### 7. 包结构:单包多入口(方案二)

```
@codejoo/picman          → 页面运行时(B 显式 API + A 零改造接管)
@codejoo/picman/sw       → SW 端(拦截、判定、占位生成、缓存、通知)
@codejoo/picman/element  → <pic-man> Web Component
@codejoo/picman/shared   → 协议常量、类型、图片头解析器(两端共用)
dist/picman-sw.js        → 托管模式预构建成品
```

各入口独立 tree-shake;不拆多包(YAGNI)。

## 测试方案

vitest,四层:

1. **字节层单测(主力)**:嗅探、三格式块遍历器、首帧截断重组(增量喂字节 → 断言产物字节结构合法)、SVG 色块、调色板取色。fixtures 程序化生成微型动图,不入库大二进制。
2. **管线逻辑单测**:SW 管线依赖注入(fetch/caches/clients/canvas 可注入),mock 测阈值判定、计数转档、去重、LRU、通知对账。
3. **DOM 侧单测**:happy-dom 跑 `auto()`、`<pic-man>`、降级路径。
4. **真浏览器验收**:examples/ demo 页 + 限速本地服务人工验收;自动化 e2e v1 不做。

## 延后到下一轮的议题(静图)

- JPEG/PNG/WebP/AVIF 静图渐进(色块→轮廓→清晰);progressive JPEG/隔行 PNG 可借浏览器解码,普通 PNG 增量解码已论证无价值(轮廓完成 ≈ 全图完成),WebP/AVIF 无渐进能力需 wasm(不做)。
- `thumbSource` CDN 缩略 URL 映射(静图出轮廓的主力方案)。
- `reveal: 'blur' | 'stream'` 呈现策略(stream = tee 透传保留浏览器原生渐进渲染)。
