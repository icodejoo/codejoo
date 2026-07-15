# picman v1 设计:SW 动图渐进加载(2026-07-15)

对应需求:`docs/REQUIREMENTS.md`(2026-07-15 版)、`docs/logs/2026-07-15-1.md`、`docs/logs/2026-07-15-2.md`。

## 1. 定位与范围

Service Worker 拦截图片请求的渐进加载库。v1 只对**动图**(GIF / APNG / 动画 WebP)开启渐进流程,其余请求一律透传。体验时间轴:

```
色块占位(毫秒级,头部字节即出)
  → 静态首帧占位(下载百分之几,截断重组 + 浏览器原生解码)
  → 清晰动图开播(全图下载完,从头播放)
```

原则:**只增强、不劣化**——任何一层失败都塌向「原图正常加载」。

## 2. 包结构与构建

单包多入口:

```
src/
  shared/
    types.ts       — PicmanOptions、PlaceholderStage、公共类型
    protocol.ts    — SW↔页面消息类型、标记头名、cache-bust 参数名、缓存名常量
    sniff.ts       — 魔数嗅探:格式 + 是否动图
    walkers/
      gif.ts       — GIF 块遍历器 + 首帧截断重组
      apng.ts      — PNG chunk 遍历器 + acTL 检测 + 首帧重组
      webp.ts      — RIFF 遍历器 + VP8X 动画位检测 + 首帧重打包
  sw/
    index.ts       — setupPicman(options):fetch 监听 + 判定管线
    pipeline.ts    — 渐进流程状态机(依赖注入,可单测)
    placeholder.ts — SVG 色块合成 + 首帧位图占位(OffscreenCanvas)
    cache.ts       — Cache Storage 封装 + LRU 淘汰
    notify.ts      — clients.matchAll + postMessage
  page/
    index.ts       — 主入口:导出 load / auto / registerPicmanSW
    load.ts        — B:显式 API
    auto.ts        — A:零改造接管(<img>/srcset/picture/CSS 背景)
    reconcile.ts   — 通知丢失兜底对账
    register.ts    — registerPicmanSW(swUrl)
  element/
    index.ts       — <pic-man> Web Component(建在 load 上)
  sw-standalone.ts — 托管模式成品入口(setupPicman() 默认配置自执行)
```

`package.json` exports:

```jsonc
{
  ".": "./dist/esm/index.mjs", // page
  "./sw": "./dist/esm/sw.mjs",
  "./element": "./dist/esm/element.mjs",
  "./shared": "./dist/esm/shared.mjs",
  "./picman-sw.js": "./dist/picman-sw.js", // 托管成品,iife/单文件
}
```

约束:`shared/` 不得 import DOM 或 SW 全局;`sw/` 不得 import DOM;`page/`、`element/` 不得 import SW 全局。跨端只经 `shared/protocol.ts` 约定。

## 3. 配置(完整)

```ts
/** SW 端 */
interface PicmanSWOptions {
  threshold?: number; // 大图阈值字节,默认 102400
  include?: (string | RegExp)[]; // URL 粗筛,默认 [/\.(gif|png|apng|webp)(\?|$)/i]
  exclude?: (string | RegExp)[]; // 默认 []
  colorBlock?: "solid" | "gradient"; // 默认 'gradient'
  fallbackColor?: string; // 无调色板时的色块底色,默认 '#e0e0e0'
  firstFrame?: "sharp" | "blur"; // 默认 'sharp'
  blurRadius?: number; // firstFrame:'blur' 时的模糊半径 px,默认 12
  headBytes?: number; // 嗅探所需最小头部字节,默认 4096
  firstFrameMaxBytes?: number; // 首帧重组的最大等待字节,默认 512 * 1024;超过放弃首帧档
  cache?: { name?: string; maxEntries?: number; maxAgeSeconds?: number };
  // 默认 { name: 'picman-v1', maxEntries: 200, maxAgeSeconds: 604800 }
  onError?: (ctx: PicmanErrorContext) => void;
}

/** 页面端 auto */
interface PicmanAutoOptions {
  root?: ParentNode; // 默认 document
  backgrounds?: boolean; // 是否接管 CSS 背景图,默认 true
  onError?: (ctx: PicmanErrorContext) => void;
}
```

## 4. SW 判定管线(状态机)

`fetch` 事件,`event.request.destination === 'image'` 且同源或 CORS 可读(`response.type === 'basic' | 'cors'`;`opaque` 一律透传,读不了字节):

```
S0 入口
  ├─ 非 GET / destination 非 image → 不 respondWith(浏览器默认)
  ├─ URL 带 PICMAN_BYPASS 参数(重试标记)→ 透传网络
  ├─ URL 带 PICMAN_FULL 参数(切图二次请求,值 'ff'|'1' 区分阶段)→ S6 按阶段取对应缓存条目;未命中透传网络
  ├─ include/exclude 不命中 → 不 respondWith
  └─ 命中 → S1
S1 发真实请求 fetch(request)
  ├─ !response.ok 或 opaque → 原样返回
  ├─ Content-Length 存在且 < threshold → 原样返回(透传)
  └─ 其余 → S2(含无 Content-Length:进入边读边判)
S2 流式读:reader 逐 chunk 入 buffer
  ├─ 无 Content-Length 且 累计 < threshold 且 流结束 → 拼 buffer 回完整响应(小图)
  ├─ 累计 ≥ max(headBytes, 嗅探所需) → 嗅探
  │    ├─ 非动图 → 拼已缓冲 + 余流,piping 透传(不再缓存/占位)
  │    └─ 动图 → S3
  └─ 流结束仍嗅探不出(损坏)→ 拼 buffer 原样返回
S3 出色块占位:解析宽高+调色板 → SVG 响应立即 respondWith
    (响应头:Content-Type: image/svg+xml; Cache-Control: no-store;
     X-Picman: placeholder —— no-store 防浏览器 HTTP 缓存把占位钉死在原 URL 上,关键!)
    同时 event.waitUntil(S4)
S4 后台续下(同一 reader 继续,不重发请求):
  ├─ 每 chunk 喂格式 walker,首帧边界到达且 ≤ firstFrameMaxBytes
  │    → 截断重组 → createImageBitmap 验证解码
  │    → 成功:通知页面 {type:'first-frame', url, blobUrl? 否} —— 首帧位图不传 blob,
  │      而是写入缓存 key = url + PICMAN_STAGE=ff,页面二次请求取(统一走缓存,消息保持轻量)
  │    → 失败:onError,停留色块档,继续下载
  └─ 流结束 → S5
S5 全图落盘:cache.put(url, 完整响应克隆) + LRU 检查 → 通知 {type:'complete', url}
  ├─ put 配额失败 → LRU 驱逐一半后重试一次;再败:仍通知 complete,二次请求走网络
S6 二次请求(PICMAN_FULL):caches.match(url) 命中回全图(剥掉标记参数后匹配);未命中透传
```

**性能关键点**:

- S2~S4 全程同一个 `ReadableStream` reader,零重复请求;buffer 用 `Uint8Array` 数组累积,不做每 chunk 拼接大数组(O(n²) 禁止),重组时才一次性 `concat`。
- 嗅探/首帧边界检测是增量的:walker 维护游标状态,每 chunk 只扫新增字节,不回头重扫。
- in-flight 去重:`Map<string, Promise>` 按剥参 URL 去重,同 URL 并发 fetch 事件共享同一下载,占位各自响应。
- 占位 SVG 是字符串拼接,微秒级;首帧档才动 OffscreenCanvas。

## 5. 格式字节层算法

### 5.1 嗅探(sniff.ts)

| 判定      | 依据                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GIF       | 前 6 字节 `GIF87a` / `GIF89a`;是否动图:**遇 0x21 0xFF Netscape 循环扩展 → 动图;遇第 2 个 Image Descriptor(0x2C)→ 动图;首帧后即遇 0x3B → 静图**(三条按先到判定) |
| APNG      | PNG 签名 8 字节 + 在 IDAT 之前发现 `acTL` chunk → 动图;否则静图                                                                                                |
| 动画 WebP | `RIFF....WEBP` + `VP8X` chunk 且 flags bit1(Animation)=1                                                                                                       |
| 其他      | 非动图,透传                                                                                                                                                    |

嗅探可能需要的字节数不定(acTL 在 IHDR 后但 IDAT 前),增量喂,返回三态:`'animated' | 'static' | 'need-more'`;流结束仍 `need-more` → 按 static 透传。

### 5.2 GIF walker(gif.ts)

结构游标:Header(6) → LSD(7,含宽高 LE、GCT 标志/大小)→ [GCT 3×2^(n+1)] → 循环块:
`0x21` 扩展(标签 1B + 子块串,每子块长度前缀,0x00 结尾)/ `0x2C` Image Descriptor(9B + [LCT] + LZW 最小码 1B + 数据子块串)/ `0x3B` trailer。

- 宽高:LSD offset 6~9。颜色:GCT 存在则取全部条目算平均 + 明暗两端(按亮度排序取 P10/P90)。
- 首帧重组:收齐首个 Image Descriptor 的完整数据子块串后,产物 = `原字节[0..首帧末] + 0x3B`。**保留首帧前的 GCE 扩展**(透明色标志在里面),剥掉 Netscape 循环扩展(单帧无意义,留着也合法——为简化:保留一切 0x21 扩展,只在末尾补 0x3B,浏览器容忍)。

### 5.3 APNG walker(apng.ts)

PNG chunk 流:签名 8B → 循环 [len 4B BE + type 4B + data + CRC 4B]。

- 宽高:IHDR data offset 0~8(BE)。颜色:PLTE 有则同 GIF 取法;真彩 APNG 无 PLTE → fallbackColor。
- 首帧重组:APNG 规范——**默认图(IDAT)即首帧**(fcTL 在 IDAT 前时)。产物 = 签名 + 所有 IDAT 之前的非动画 chunk(剔除 acTL/fcTL/fdAT)+ 全部 IDAT + 手工 IEND(固定 12 字节 `00 00 00 00 49 45 4E 44 AE 42 60 82`)。IDAT 结束判定:遇到首个非 IDAT chunk 头。
- 边界:若 acTL 声明首帧不是默认图(IDAT 前无 fcTL 的变体),仍用 IDAT——展示上等价于 PNG 查看器的静态回退图,可接受。

### 5.4 动画 WebP walker(webp.ts)——尝试档

RIFF:`RIFF + size(4 LE) + WEBP` → chunk 流 [fourcc 4B + size 4B LE + data(奇数补齐 1B)]。

- 宽高:VP8X data offset 4~10(24bit LE,存值 = 实际-1)。颜色:无,fallbackColor。
- 首帧重打包:找首个 `ANMF` chunk,其 data offset 16 起是子 chunk(`VP8 `/`VP8L`,可带 `ALPH`)。产物 = 手工 RIFF 头 + `WEBP` + [VP8X(改 flags:清 Animation 位,保留 Alpha 位)+ ALPH?] + VP8/VP8L chunk,RIFF size 重算。失败(结构不符/解码 reject)→ 停留色块档,onError。

### 5.5 重组产物验证

一律 `createImageBitmap(new Blob([bytes], {type: mime}))` 真解码验证,reject 即视为失败(不把坏占位发给页面)。成功后:`firstFrame:'sharp'` 直接编码 PNG(`OffscreenCanvas.convertToBlob`);`'blur'` 先 `ctx.filter = 'blur(Npx)'` 绘制再导出。缩放:位图长边 > 512 时等比缩到 512 再导出(占位不需要原尺寸,省缓存)。

## 6. SW↔页面协议(protocol.ts)

```ts
const CACHE_NAME = "picman-v1";
const PARAM_FULL = "__picman_full__"; // 二次请求标记(值=阶段:'ff' | '1')
const PARAM_BYPASS = "__picman_bypass__"; // 重试透传标记
const HEADER_MARK = "X-Picman"; // 'placeholder' | 'first-frame' | 'full'

type PicmanMessage =
  | { picman: 1; type: "first-frame"; url: string } // url = 剥参原始 URL
  | { picman: 1; type: "complete"; url: string }
  | { picman: 1; type: "error"; url: string; stage: "download" | "first-frame"; message: string };
```

页面切图 = 对元素重设 `src = url + PARAM_FULL=1`(或 ff),请求回到 SW 走缓存;`Cache-Control: no-store` 保证占位不污染 HTTP 缓存,全图响应保留原响应头(可正常缓存)。URL 匹配一律先剥两个标记参数。

## 7. 页面端

### 7.1 load(B,底座)

```ts
interface PicmanTask {
  url: string;
  onStage(cb: (stage: "placeholder" | "first-frame" | "complete", displayUrl: string) => void): void;
  done: Promise<string>; // resolve 全图 displayUrl;下载失败 reject
}
function load(url: string): PicmanTask;
```

实现:`navigator.serviceWorker.controller` 不存在 → 立即回 `complete` + 原 URL(降级)。存在 → 监听 `message`,过滤 `picman:1` 且 URL 匹配;返回的 displayUrl 就是带阶段参数的原 URL(浏览器自己发请求命中 SW)。

### 7.2 auto(A)

- 启动:`MutationObserver`(childList+subtree+attributes:src/srcset/style)+ 首次全量扫描 `root.querySelectorAll('img')`。
- 维护 `Map<剥参URL, Set<WeakRef<Element>>>`;收到 `first-frame`/`complete` 消息 → 对映射元素重设 `src`/`srcset` 追加阶段参数。
- CSS 背景(`backgrounds:true`):扫描 inline `style` 与 `document.styleSheets` 中 `url(...)`;跨域样式表(读 `cssRules` 抛 SecurityError)跳过;动态背景支持 `data-picman-bg="url"` 显式标记。切换 = 改该元素 inline `backgroundImage`。
- 对账(reconcile.ts):元素进入映射时若已错过通知——`caches.match(url + full)` 页面侧直查(window 可访问 CacheStorage),命中即切;另在 `visibilitychange→visible` 时对所有未完成映射批量对账。

### 7.3 `<pic-man>`(C)

Custom Element,observed attributes:`src`、`alt`、`first-frame`。Shadow DOM 内一个 `<img>`,内部用 `load()`,阶段切换自动完成;`disconnectedCallback` 解绑。SW 不可用 → 直接 `<img src>`。

### 7.4 registerPicmanSW

`navigator.serviceWorker.register(swUrl, { type: 'module' })` + `navigator.serviceWorker.ready` + 若无 controller 提示需刷新(返回 `{ controlled: boolean }`,不自动 reload)。

## 8. 缓存(cache.ts)

- 条目:`cache.put(Request(剥参 url + PARAM_FULL 变体), response)`;首帧占位与全图是两个 key(`ff` / `1`)。
- LRU:Cache API 无时间戳——另存一个索引条目 `__picman_index__`(JSON:`{url: {ts, size}}`),每次 put/match 更新;超 `maxEntries` 或过期(`maxAgeSeconds`)按 ts 驱逐,全图和其 ff 条目成对删。
- 时间来源:SW 里 `Date.now()` 正常可用(workflow 限制与此无关)。

## 9. 错误处理(定案表)

见 `docs/REQUIREMENTS.md` 第 6 节,实现按表逐条落。补充实现细节:

- `onError` 两端签名统一 `PicmanErrorContext = { url, stage, error }`,内部 try/catch 包裹每个阶段,**任何异常不得逃逸到 fetch handler 外**(否则浏览器取消请求)——最外层 catch 后塌向 `fetch(request)` 透传。
- 页面 `message` 监听器对不认识的消息(无 `picman:1`)一律忽略。

## 10. 测试(vp test / vitest)

1. **字节层**:`test/fixtures.ts` 程序化生成最小合法动图(GIF:2 帧 2×2;APNG:acTL+2 fdAT;动画 WebP:VP8X+2 ANMF,VP8L 无损 1×1 帧,手工字节)。测嗅探三态、walker 增量喂(1 字节/次极端切分)、重组产物结构断言(GIF 尾 0x3B、PNG IEND CRC、RIFF size 一致性)、调色板取色。
2. **管线**:pipeline.ts 依赖注入(`fetchImpl/cacheImpl/notifyImpl/decodeImpl/now`),mock 测:阈值三分支、无 CL 计数转档、嗅探非动图透传、首帧超 `firstFrameMaxBytes` 放弃、put 配额失败重试、in-flight 去重、LRU 驱逐成对删。
3. **DOM**:happy-dom——auto 的 Mutation 捕获/切图/WeakRef 清理、对账路径、`<pic-man>` 属性响应、SW 缺失降级。
4. **人工验收**:`examples/index.html` + 限速静态服务(node 脚本,chunk 间 setTimeout),肉眼三段时间轴。CHANGELOG 与 README 同步。

## 11. 明确不做(v1)

静图渐进、`thumbSource`、`reveal: stream`、wasm 解码、PNG 增量解码、自动化 e2e、请求取消。
