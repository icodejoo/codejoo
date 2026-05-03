# 浏览器端 E2E 演示

按场景卡片点击 <kbd>运行</kbd>，观察请求 / 响应 / 副作用。请求经 vite proxy（`/api/*`）转发到本地 Bun mock server。

## 启动

需要 **两个** 终端：

### Terminal 1 —— Bun mock server

```bash
npm run mock        # = bun server/dev.ts
# [mock] listening on http://localhost:3030
```

可选环境变量 `MOCK_PORT=3050` 改端口。

### Terminal 2 —— Vite dev server (e2e mode)

```bash
npm run dev:e2e     # = vite --mode e2e
# Local:   http://localhost:5173/
```

打开浏览器访问 http://localhost:5173/，每张卡片对应一个插件场景。

## 架构

```
浏览器  →  vite dev server (5173)  →  proxy /api/*  →  Bun mock (3030)
                ↑
                └─ e2e/main.ts 运行时 import '../src'（直连源码，HMR 友好）
```

vite 配置：[`vite.config.ts`](../vite.config.ts) 中 `mode === 'e2e'` 分支启用 proxy + root=e2e/。
Bun mock 路由表：[`server/server.ts`](../server/server.ts) `buildRoutes()`。

## 场景覆盖

| 卡片 | 演示插件 / 能力 |
|---|---|
| normalize · 全链路归一化 | normalize 把 200 / 500 / network / 业务码统一成 ApiResponse |
| cache · TTL + 共享池 | cache miss → hit → removeCache / clearCache |
| share · 同 key 并发去重 | start 策略：3 并发只发 1 次 HTTP |
| retry · 失败重试 + Retry-After | 失败 N 次后成功；状态码 + 限流头 |
| cancel · 分组 + cancelAll | aborter:'group' / cancelAll(group?) |
| loading · delay + mdt | 快请求不闪 / 慢请求至少留 500ms |
| concurrency · 限流 + priority | max=4 排队；priority 跳队 |
| reurl · 路径参数 + 分隔符规整 | `/{id}` ← params；baseURL/url 之间补 / 或去重 |
| filter · 空字段过滤 | null / '' / undefined / NaN 自动剔除 |
| mock · 请求级 mock | config.mock 拦截返回伪造响应 |
| key · key 计算 | key=true 自动生成；驱动 cache / share |
| envs · 环境配置 | install 时按 default 选 rule 合并到 axios.defaults |

## 修改演示

每个场景在 [`main.ts`](./main.ts) `scenarios` 数组里。要加新场景：往数组里 push 一个 `Scenario` 即可，框架自动渲染卡片。

## 限制

- e2e/main.ts 直接 `import '../src'` —— 跑的是源码而非 `npm run build` 产物。要验证产物，把导入改成 `'http-plugins'` 后 `npm run build` + `npm link`（项目当前 `private: true` 没发包，按需调整）。
- 该 demo 是手动验证用，**不是自动化 e2e** —— 需要 playwright / cypress 才能纳入 CI。
