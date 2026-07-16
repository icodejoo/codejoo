# Picman 架构文档

## 项目概述

**@codejoo/picman** 是一个 Service Worker 驱动的渐进式图像加载库，专门支持动画格式（GIF、APNG、动画 WebP），框架无关。

## 核心架构

```
<img> or <pic-man> 元素
    ↓
[Web Component (Custom Element)]
    ├─ 属性解析 (src, alt, etc.)
    └─ 生命周期管理
    ↓
[Service Worker 注册]
    ├─ 请求拦截
    ├─ 缓存策略
    └─ 性能优化
    ↓
[请求拦截处理]
    ├─ 匹配图像 URL
    ├─ 检查缓存 (Cache Storage)
    └─ 缓存命中 → 返回缓存
         缓存未命中 → 网络请求
    ↓
[渐进式加载]
    ├─ 第一帧 (快速显示占位图)
    ├─ 后续帧 (逐帧加载，支持动画)
    └─ 缓存每一帧
    ↓
[Canvas 渲染]
    ├─ 帧数据解码
    ├─ 绘制到 Canvas
    └─ 更新 DOM
    ↓
[缓存存储]
    ├─ Cache Storage API
    ├─ IndexedDB (帧数据)
    └─ 跨标签页共享
    ↓
用户看到的动画图片
```

## 主要特性

### 1. **Web Component 集成**

- 自定义元素 `<pic-man>`
- 标准 HTML 属性支持
- 可独立使用，无框架依赖

### 2. **Service Worker 驱动**

- 在 Service Worker 中拦截图像请求
- 智能缓存策略
- 跨标签页缓存共享

### 3. **渐进式加载**

- 首帧优先加载，快速显示
- 后续帧在后台逐步加载
- 动画格式解析（GIF/APNG/WebP）
- 支持在加载中播放动画

### 4. **高性能缓存**

- 使用 Cache Storage API 缓存完整资源
- 使用 IndexedDB 缓存帧数据
- 避免重复网络请求
- 离线支持

### 5. **动画格式支持**

- **GIF**: 完整支持，包括透明度
- **APNG**: 现代 PNG 动画格式
- **动画 WebP**: 新一代网络图像格式
- 自动格式检测和解析

## 文件结构

```
src/
├── index.ts                 # 主入口
├── element/
│   ├── pic-man.ts          # Web Component 定义
│   ├── lifecycle.ts        # 生命周期管理
│   └── attributes.ts       # 属性处理
├── sw/
│   ├── handler.ts          # Service Worker 处理器
│   ├── cache-strategy.ts   # 缓存策略
│   └── request-intercept.ts # 请求拦截
├── decoder/
│   ├── gif-decoder.ts      # GIF 解析
│   ├── apng-decoder.ts     # APNG 解析
│   ├── webp-decoder.ts     # WebP 解析
│   └── base-decoder.ts     # 解码器基类
├── loader/
│   ├── progressive-loader.ts # 渐进式加载
│   ├── frame-loader.ts     # 帧加载器
│   └─ chunk-manager.ts     # 分块管理
├── cache/
│   ├── storage-api.ts      # Cache Storage
│   ├── indexeddb-api.ts    # IndexedDB
│   └─ storage-manager.ts   # 存储管理
├── renderer/
│   ├── canvas-renderer.ts  # Canvas 渲染
│   └─ frame-scheduler.ts   # 帧调度 (RAF)
└── shared/
    ├── types.ts            # 共享类型
    └─ constants.ts         # 常量
```

## 核心流程

### 1. 初始化

```typescript
// 注册 Service Worker
await navigator.serviceWorker.register("/picman-sw.js");

// 定义 Web Component
import { PicMan } from "@codejoo/picman";
customElements.define("pic-man", PicMan);
```

### 2. 使用

```html
<pic-man src="animated.gif" alt="示例动画"></pic-man>
```

### 3. 加载流程

```
用户在页面中使用 <pic-man> 元素
    ↓
[Web Component 创建]
    ├─ connectedCallback 触发
    ├─ 读取 src 和其他属性
    └─ 创建 img 或 canvas 标签
    ↓
[请求图像]
    ├─ 浏览器发起 GET 请求
    └─ Service Worker 拦截
    ↓
[Service Worker 处理]
    ├─ 检查 Cache Storage 缓存
    ├─ 缓存命中 → 返回缓存数据
    └─ 缓存未命中 → 网络请求
    ↓
[网络请求]
    ├─ 下载图像资源
    ├─ 存储到 Cache Storage
    └─ 返回数据流
    ↓
[渐进式加载]
    ├─ 解析第一帧数据
    ├─ 在 Canvas 上渲染第一帧
    ├─ 立即显示给用户（占位图）
    └─ 后台继续加载后续帧
    ↓
[帧解析和缓存]
    ├─ 解析动画格式（GIF/APNG/WebP）
    ├─ 提取每一帧
    ├─ 解码像素数据
    ├─ 存储到 IndexedDB（帧缓存）
    └─ 标记可播放
    ↓
[动画播放]
    ├─ 使用 RAF 调度帧更新
    ├─ 根据动画延迟切换帧
    ├─ 在 Canvas 绘制
    └─ 播放完整动画
    ↓
[多次加载优化]
    ├─ 再次加载同一图像
    ├─ Service Worker 返回缓存
    ├─ 从 IndexedDB 读取帧数据
    └─ 快速播放（无网络请求）
```

### 4. 格式检测和解析

```
图像数据
    ↓
[格式识别]
    ├─ 检查魔数 (Magic Bytes)
    ├─ GIF: 47 49 46 ("GIF")
    ├─ PNG: 89 50 4E 47 ("PNG")
    └─ WebP: "WEBP" 在 RIFF 头
    ↓
[选择对应解码器]
    ├─ GIF → GIF 解码器
    ├─ APNG → APNG 解码器
    └─ WebP → WebP 解码器
    ↓
[逐帧解析]
    ├─ 读取图像全局数据
    ├─ 解析每个数据块
    ├─ 提取帧数据和延迟时间
    └─ 构建帧列表
```

## 缓存策略

### Cache Storage（整个资源）

```typescript
// Service Worker 缓存整个图像文件
const cache = await caches.open("picman-v1");
await cache.put(url, response);
```

### IndexedDB（帧数据）

```typescript
// 存储解析后的帧数据
const frameData = {
  url: "image.gif",
  frames: [
    { delay: 100, imageData: ArrayBuffer },
    { delay: 100, imageData: ArrayBuffer },
    // ...
  ],
};
```

## 性能优化

### 1. **首帧快速显示**

- 解析第一帧后立即渲染
- 用户快速看到内容

### 2. **后台加载**

- 使用 Web Worker 解析帧
- 不阻塞主线程

### 3. **内存管理**

- 帧数据按需存储
- 支持最大缓存配置

### 4. **跨标签页缓存**

- Cache Storage 和 IndexedDB 自动跨标签页同步
- 一个标签页缓存的内容其他标签页可直接使用

## 与其他项目的关系

- **@codejoo/storage**: 可用于配置存储（缓存大小限制等）
- **@codejoo/counter**: 可能在动画控制中使用 RAF 调度

## 参考

- [README.md](./README.md)
- [源代码](./src)
- [Web Component 标准](https://html.spec.whatwg.org/multipage/custom-elements.html)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
