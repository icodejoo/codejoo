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
