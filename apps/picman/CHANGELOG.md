# Changelog

## 0.2.0 (Unreleased)

- 重构:移除 0.1.0 的内存元数据管理器(Picman 类),转型 SW 动图渐进加载库
- 新增:shared 基础层(bytes/protocol/types)与多入口构建配置
- 新增:测试用程序化生成微型动图 fixtures(GIF/APNG/动画 WebP)
- 新增:GIF walker(增量扫描、动图判定、首帧截断重组)
- 新增:APNG walker(acTL 判定、默认图像首帧重组)
- 新增:动画 WebP walker(VP8X 判定、首帧重打包,尝试档)
- 新增:统一魔数嗅探入口 sniff,分派三格式 walker
- 新增:占位生成(SVG 色块 + 首帧位图渲染)
- 新增:缓存层 PicmanCache(Cache Storage + LRU 淘汰)
- 新增:SW 管线(阈值/嗅探状态机、占位响应、后台下载去重)+ setupPicman 自装/托管入口
- 新增:页面端显式 API load()(阶段事件+对账)与 registerPicmanSW
- 新增:页面端零改造接管 auto()(img/背景元素跟踪、阶段切换、错过通知补偿)
- 新增:`<pic-man>` Web Component(基于 load() 的框架无关封装)
- 新增:demo 页 + 限速静态服务(examples/),README 按渐进加载库重写
- 新增:examples/big.gif(程序化生成的 60 帧、724KB 测试动图,供 demo 人工验收用)
- 新增:视频拦截(降 LCP)——页面端 `<video>` facade `auto({ videos: true })`:中和 autoplay/preload 贪婪加载,用封面占位(有 poster 直接用,无 poster 上 SVG 色块并可在 LCP 之后抓真实首帧升级),手势/`.play()`/autoplay(after-lcp)时还原真实源播放
- 新增:协议 `PARAM_PLAY` / `withPlayParam()`,`stripPicmanParams` 一并剥除播放标记
- 新增:SW 兜底门控 `PicmanSWOptions.deferVideos`(默认关)——未带播放标记的视频请求返回 204 deferred 响应,带标记则原生透传(保留 Range)
- 新增:页面端视频配置 `videos` / `videoFrame` / `videoRangeBytes` / `videoAutoplay` / `videoAutoplayDelay`
- 重构:`svgColorBlock` 及色块纯函数下沉到 `src/shared/placeholder.ts`(新增 `svgDataUri`),`sw/placeholder.ts` re-export 保持兼容
- 验证:跨域 CDN 资源加载功能——Service Worker 与缓存机制对所有 CORS 源有效,三段加载流程正常工作
- 改进:demo 页增强 CDN 测试——在 placeholder 阶段开始计时,保证占位符/首帧至少显示 3 秒后才切换到完整资源,三段加载视觉效果清晰化,即使浏览器不支持 OffscreenCanvas 也能延迟显示
- 新增:AVIF 动图支持——`src/shared/walkers/avif.ts` 基于 ISOBMFF/HEIF 盒式结构解析 `ftyp` brand(`avif`/`avis`)判定动图状态,animated 时下钻 `moov > trak > mdia > minf > stbl` 解出显示尺寸、首样本字节区间(`stco`/`stsz`)与 `av1C` 编解码配置,重打包为合法单帧静态 AVIF(`meta`/`iloc`/`iprp` HEIF item);`sniff.ts`/`pipeline.ts` 接入 avif 分派,`tryRecomposeFirstFrame` 针对 AVIF 加了字节可用性边界检查
- 修复:SW 端首帧缓存 Content-Type 与实际字节不符——`makeFirstFrame` 无论源格式始终光栅化为 PNG,但缓存时错误沿用了原始格式的 mime(如 `image/avif`),现固定为 `image/png`
- 修复(关键):`background()` 调用 `deps.notify(...)` 未 await,导致 `e.waitUntil()` 延长的生命周期未能覆盖 postMessage 跨进程投递的完整耗时——HTML parser 的预加载扫描器独立于脚本执行时序发起 `<img>` 请求,若下载/通知发生得足够快(尤其被 `auto()` 页面端消息监听器完成注册抢先),SW 可能被浏览器提前回收,导致 first-frame/complete 通知静默丢失,页面永远卡在占位符阶段。现 `PipelineDeps.notify` 类型改为 `Promise<void>`,`background()` 内三处调用点均已 await
- 新增:`auto()` 增加 Cache Storage 对账兜底(`track()` 内的 `reconcileFromCache`),与 `load()` 的对账逻辑一致——即使 SW 通知因上述竞态或 SW 重启等原因丢失,只要 Cache Storage 里已有对应阶段数据,页面最终也能补上正确的显示(先查 `ff` 再查 `1`,保持 LCP 友好的展示顺序)
- 改进:demo 页重写为直接在 HTML 里写 `<img src>` 触发 auto() 零改造接管(不再依赖显式 load() API 的输入框+按钮交互),新增跨域 CDN 图片 / 同域 giphy.gif 对照组,以及 autoplay 视频 IntersectionObserver 触发时机的可视化验证区块
- 新增:LCP 友好原则——提取共享的 `src/page/idle.ts`(`scheduleIdle`,原 video facade 内部实现),`load()`/`auto()` 的 first-frame/complete 应用统一改为在主线程空闲(近似 LCP 之后)才真正生效,无论这个阶段是通过 SW 实时通知还是 Cache Storage 对账命中拿到的——保证重复访问时的瞬间缓存命中,不会抢在页面 LCP 之前把(往往解码更重的)真实内容替换上去;`auto()` 新增 `applyStageWhenIdle` 并防止阶段倒退(idle 回调乱序时,不会把已经是完整内容的页面误降级回首帧占位)
- 新增:静态大图(PNG/JPEG)渐进加载(`staticProgressive` 选项,默认开)——占位色块 → 部分字节缩略图 → 完整图三段;缩略图触发时机为逐图动态的结构性"可显示"信号而非固定字节数:渐进式 JPEG 是首个 scan 收完(全图模糊可解),baseline JPEG/PNG 是越过结构头(SOS/IDAT)后攒到最少一段像素数据(顶部切片可解);缩略图阶段缓存的是已到达的原始前缀字节,由页面 `<img>` 的宽容解码器直接渲染
- 新增:`src/shared/walkers/jpeg.ts`(SOF 尺寸解析、SOS/首 scan 结束检测)、`scanPng` 增加 `idatBytes` 已到像素字节计数、`sniff` 增加 `staticDisplayable` 统一信号;默认 include 规则加入 `jpe?g`
- 新增:`auto()` 完整阶段视口门控——高清('1')按元素粒度只在真正进入可见区后才切换(IntersectionObserver,不可用时退回立即切换),视口外元素停留在缩略图/首帧,滚入可见区立即换高清;stop() 一并断开该观察器
- 新增:`examples/big.png`(程序化生成的 412KB 真实可解码 PNG,供静态渐进 demo/验收用)
