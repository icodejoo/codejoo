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
- 改进:demo 页增强 CDN 测试——首帧阶段显示静态 PNG（不动,opacity 0.6）,完整阶段延迟 3 秒才启动 WebP 动画,三段加载视觉效果清晰化
