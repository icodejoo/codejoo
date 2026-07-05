# e2e — 端到端 UI 测试

用**真实 Chromium**(Playwright)驱动一个**可手动启动**的交互式演练场,对 `src/` 每个公开 API
做端到端断言。演练场调用一个**独立 Node mock 服务**(可控延迟 / 失败 / 业务信封),因此
cache / share / retry / cancel / loading 这类依赖真实异步 HTTP 时序的行为能被真实验证。

```
e2e/
├── server/mock-server.mjs   # 零依赖 mock 后端(:4570)，命中计数证明 cache/share 是否真发网络
├── playground/              # 交互式演练场(vite dev, :5180)
│   ├── index.html
│   └── main.ts              # 每个公开 API 一张卡片 + data-testid 控件 + 结果面板
├── run.mjs                  # Playwright 自动化：逐项点按钮并断言(37 个 case)
└── README.md
```

## 方式一:手动启动 + 手动测试

一条命令同时拉起 mock 后端与演练场,然后在浏览器里逐张卡片点按钮、看结果面板:

```bash
npm run e2e:dev        # mock 后端 :4570 + 演练场 :5180(Ctrl+C 同时退出)
# 浏览器打开 http://localhost:5180 ,逐个按钮点击观察 JSON 结果(绿边=成功/红边=失败)
```

顶部有全局 `loading` 指示器;每张卡片底部的 `<pre>` 显示该动作的真实响应。

> 需要单独起某一个时:`npm run e2e:server`(仅 mock)/ `npm run e2e:playground`(仅演练场)。

## 方式二:自动化(Playwright + 真实 Chromium)

```bash
npm run e2e            # 若 :4570/:5180 已在跑则复用,否则自动拉起,跑完回收;失败退出码 1
```

`run.mjs` 用安装好的 `playwright` 库启动 Chromium,导航到演练场,逐项点击 37 个动作按钮并断言
返回结果,同时监控页面是否有任何 console / pageerror。最后打印覆盖与通过情况:

```
covered API actions: 42 | cases: 37/37 passed
ALL E2E PASSED ✅
```

> 复用方式:先跑方式一的两个服务,再开第三个终端 `npm run e2e`,会自动复用已起的服务。

## API 覆盖(100% 公开导出)

| 模块 | 覆盖的导出 / 行为 |
|---|---|
| Core | `create` · `Core` · `get/post/put/delete/patch/head/options` · 三态返回 `raw`/`wrap`/解包 · `use`/`eject`/`plugins`/`extends` |
| reqkey | `reqkey` · `$key`(simple / deep 双车道 64-bit) |
| cache | `cache` · `removeCache` · `clearCache`(用服务端命中数证明只发一次网络) |
| share | `share` 的 `start`/`race`/`end`/`retry` 四策略 |
| retry | `retry`(失败重试到成功 / `retry:0` 禁用) |
| cancel | `cancel` · `cancelAll`(`axios.isCancel` 验证中止) |
| loading | `loading`(全局计数 0→1 / 1→0 触发) |
| mock | `mock`(URL 重写到 mockUrl;mock 不存在时默认回落真实接口) |
| envs | `envs`(安装期规则合并) |
| reqclean | `reqclean`(空字段过滤) |
| repath | `repath`(`{id}`/`:pid` 替换) |
| normalizeResponse | `normalizeResponse` · `ApiError`(业务失败以 ApiError reject) |
| TokenManager | `TokenManager`(set/get/clear,Bearer 前缀) |
| ApiResponse | `ApiResponse`(fromResponse 防 null + 成功判定) |

## mock 服务端点速查

| 端点 | 用途 |
|---|---|
| `GET /api/hit?id=&fail=&delay=&code=&status=` | 命中即对 id 计数 +1,返回 `{id,hits}`;`fail=N` 前 N 次返回 500 |
| `GET /api/hits?id=` | 只读当前命中数(断言用,不增加) |
| `POST /api/hits/reset` | 清空全部计数 |
| `GET/POST /api/echo` | 回显 method/query/body 到 `data` |
| `GET /mock/*` | mock 插件重写目标,`data.mocked=true` |
| `GET /mock-404/*` | 永远 404,演示 `mock.fallback` 回落真实接口 |
| 其它路径 | 回显最终 path(验证 replace-path-vars 替换结果) |
