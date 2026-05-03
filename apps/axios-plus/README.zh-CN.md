# http-plugins

中文 | [English](./README.md)

基于 `axios` 的类型驱动、插件化 HTTP 客户端。OpenAPI codegen 产物（`model.PathRefs`）驱动 URL 自动补全 + 请求/响应类型推断；十余个内置插件按 use 顺序自由组合，业务方代码只看到一种 settle 形态：`ApiResponse`。

---

## 设计契约：normalize-先 / rethrow-后

走"全链路归一化 + onFulfilled 单路径 + 末端裁决 reject"模型：

1. **`normalize` 必须最先 use** —— 把 axios 的所有 settle 形态（成功 / HTTP 错误 / 网络 / 超时 / cancel / 业务错）统一成 `response.data: ApiResponse` 后 **resolve**。所有 settle 路径只走 onFulfilled。
2. **中间插件只工作在 onFulfilled** —— 直接读 `response.data: ApiResponse`，不做 shape detection、不写 try/catch。
3. **`rethrow` 最后 use** —— 按 `apiResp.success` 决定要不要把 `ApiResponse` 重新 reject 给业务方。
4. **依赖检查 install-time 强制** —— `retry` / `rethrow` / `notification` / `auth` 在 install 时 `requirePlugin('normalize')`，没装直接抛错。

业务侧错误处理简化为单一形态：

```ts
try {
  const r = await api.get('/x')();   // r 一定是已经成功的 ApiResponse
  renderPet(r.data);
} catch (apiResp) {                  // 一定是 ApiResponse（rethrow 抛出）
  if (apiResp.code !== ERR_CODES.CANCEL) toast(apiResp.message);
}
```

---

## Quick start

```bash
pnpm install
```

```ts
import axios from 'axios';
import { create, ERR_CODES } from 'http-plugins';
import normalizePlugin from 'http-plugins/plugins/normalize';
import rethrowPlugin   from 'http-plugins/plugins/rethrow';

const api = create<model.PathRefs>(
  axios.create({ baseURL: 'https://api.example.com' }),
  { debug: true },
);

api.use([
  normalizePlugin({ success: (r) => r.code === '0000' }),
  rethrowPlugin(),
]);

// 路径自动补全 + 请求/响应类型推断
const findByStatus = api.get('/pet/findByStatus');
const pets = await findByStatus({ status: 'available' });
//    ^? model.Pet[]
```

不绑 schema 时退化为薄 axios 封装：路径接受任意字符串，请求/响应默认为 `unknown`。

---

## 推荐 use 顺序

```ts
api.use([
  // ① 必须最先 —— 归一化所有 settle 形态
  normalizePlugin({ success: (r) => r.code === '0000' }),

  // 请求侧（顺序无强约束）
  filterPlugin(), reurlPlugin(), keyPlugin(), cancelPlugin(),
  envsPlugin([/* ... */]), mockPlugin({ baseURL: '/__mock__' }),

  // adapter 包装（后 use 的最先执行 —— cache 命中可避开后面所有层）
  cachePlugin({ stt: 60_000 }),
  sharePlugin(),
  concurrencyPlugin({ max: 6 }),
  loadingPlugin({ loading: showSpinner }),

  // 响应侧（FIFO，先 use 的先看响应）
  retryPlugin({ max: 3 }),
  notificationPlugin({ notify: toast.error }),
  authPlugin({ tokenManager, protected: ['/admin/*'] }),

  // ② 必须最后 —— 按 apiResp.success 决定 reject
  rethrowPlugin(),
]);
```

> **顺序语义**：axios 原生 —— 请求拦截器 LIFO（后 use 先执行），响应拦截器 FIFO（先 use 先执行），adapter 后 use 覆盖前者。详见 [`src/plugin/`](./src/plugin/) 的 PluginManager 文档。

---

## 内置插件一览

每个插件在 [`src/plugins/<name>/`](./src/plugins/) 下都有独立 README，含完整配置、矩阵、与其他插件分工。下表只列**用途**与**核心配置**。

| 插件 | 用途 | 核心配置 |
|---|---|---|
| [`normalize`](./src/plugins/normalize/) | 全链路归一化为 `ApiResponse`，永远 resolve | `success(apiResp) => boolean` 必传；`{code,message,data}KeyPath` 自定义信封字段 |
| [`rethrow`](./src/plugins/rethrow/) | 链尾按 `apiResp.success` 决定 reject | `shouldRethrow(apiResp)`、`transform(apiResp)` 改写 reject 值 |
| [`key`](./src/plugins/key/) | 生成稳定请求指纹（FNV-1a 哈希），作为 cache / share / retry 的连接维度 | `dimensions: ['method','url','params','data']` |
| [`cache`](./src/plugins/cache/) | adapter 层 TTL 响应缓存，命中直接返回不发 HTTP | `stt`（TTL ms）、`storage`（默认 sessionStorage）、`give(resp)` 决定缓存什么 |
| [`share`](./src/plugins/share/) | 同 key 并发去重 | `policy: 'start' \| 'end' \| 'race' \| 'none'` |
| [`concurrency`](./src/plugins/concurrency/) | 并发上限 + FIFO 优先级队列 | `max`、请求级 `priority` / `concurrency:false` 绕过 |
| [`loading`](./src/plugins/loading/) | 全局引用计数 loading：首发 `cb(true)`，全部 settle 后 `cb(false)` | `loading: (visible: boolean) => void` |
| [`cancel`](./src/plugins/cancel/) | 自动注入 `AbortController`；`cancelAll(ax)` 一键中止 | 无；按 url / method 黑白名单可选 |
| [`retry`](./src/plugins/retry/) | 失败重试 + 指数退避 + `Retry-After` 头解析 + jitter | `max`、`methods` / `status` 合并默认、`shouldRetry(ctx)`、`beforeRetry(ctx)` |
| [`notification`](./src/plugins/notification/) | 失败时调 toast；按 code / status 路由文案 | `notify(msg)`、`messages: { [code]: string }` |
| [`auth`](./src/plugins/auth/) | Token + 401/403 自动刷新；并发刷新协议；stale-token 自动重放 | `tokenManager`、`methods`/`urlPattern`/`isProtected`、`onFailure → AuthFailureAction`、`onRefresh`、`onAccessExpired` |
| [`filter`](./src/plugins/filter/) | 剥离 `params` / `data` 中的 `null` / `undefined` / `NaN` / 空白 | `predicate(value, key)` 自定义保留规则 |
| [`reurl`](./src/plugins/reurl/) | 用 `params` / `data` 字段替换 `:id` / `{id}` / `[id]`，并规整 `baseURL` 与 `url` 的分隔符 | `removeKey: true` 替换后从 params 删除原字段；`fixSlash: true` 规整 `/` |
| [`mock`](./src/plugins/mock/) | dev 下把 url 重写到 mock 服务器 | `baseURL`、`enabled`（全局开关或按请求 opt-in） |
| [`envs`](./src/plugins/envs/) | install 时按规则选 `axios.defaults`（DEV / PROD / staging） | `envs: IEnvRule[]`、`pick(env) => index` |

---

## 自定义插件

```ts
import type { Plugin } from 'http-plugins';

const logging: Plugin = {
  name: 'logging',
  install(ctx) {
    ctx.request((cfg)  => { ctx.logger.log('→', cfg.method, cfg.url);   return cfg;  });
    ctx.response((res) => { ctx.logger.log('←', res.status, res.config.url); return res; });
    ctx.cleanup(() => ctx.logger.log('ejected'));
  },
};

api.use(logging);
api.eject('logging');     // 拦截器 / adapter / transform / cleanup 一笔勾销
```

`ctx` API 速查、生命周期、`extends` 派生子 Core、`runWhen` 条件拦截器等高级用法见 [`src/plugin/README.zh-CN.md`](./src/plugin/README.zh-CN.md)。

---

## 联调阶段：扩展 `model.PathRefs`

`types/paths.d.ts` 是 codegen 产物，永远不要手改。临时路径通过**声明合并**登记到 [`types/local/`](./types/local/) —— 模板见 [`types/local/example.d.ts.template`](./types/local/example.d.ts.template)。接口正式发布后从 `local/` 删条目即可，冲突会触发 TS 编译错误，不会悄无声息漂移。

---

## 三种响应形态

```ts
const post = api.post('/pet');

await post(payload);                    // Promise<Pet>           —— 拆包后的 data
await post(payload, { raw: true });     // Promise<{code,data,message?}>
await post(payload, { wrap: true });    // Promise<ApiResponse<Pet>>
```

---

## 错误码常量

```ts
import { ERR_CODES } from 'http-plugins';
// ERR_CODES.HTTP    'HTTP_ERR'    HTTP 4xx/5xx 但服务端无 envelope
// ERR_CODES.NETWORK 'NETWORK_ERR' 断网 / DNS / 拒连
// ERR_CODES.TIMEOUT 'TIMEOUT_ERR' ETIMEDOUT / ECONNABORTED
// ERR_CODES.CANCEL  'CANCEL'      用户主动 cancel
```

---

## 协议

MIT
