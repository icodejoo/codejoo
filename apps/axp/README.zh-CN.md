# http-plugins

中文 | [English](./README.md)

基于 `axios` 的类型驱动、插件化 HTTP 客户端。由 OpenAPI 规范通过 codegen 生成的
schema (`model.PathRefs`) 驱动 URL 自动补全、请求体类型推断、响应体类型推断的
端到端类型安全。

## 完整使用示例

```ts
import axios from 'axios';
import { create, type Plugin } from 'http-plugins';

/* 1) 包装 axios 实例并绑定 schema。 -------------------------------------- */
const api = create<model.PathRefs>(
  axios.create({ baseURL: 'https://api.example.com' }),
  { debug: true },
);

/* 2) 发起类型化请求 —— 路径 / 请求体 / 响应体均自动推断。 ----------------- */
const findByStatus = api.get('/pet/findByStatus');
const pets = await findByStatus({ status: 'available' });
//    ^? model.Pet[]

const addPet = api.post('/pet');
await addPet({ name: 'lassie', photoUrls: [] });                  // → Pet
await addPet({ name: 'lassie', photoUrls: [] }, { raw: true });   // → { code, data: Pet, message? }
await addPet({ name: 'lassie', photoUrls: [] }, { wrap: true });  // → ApiResponse<Pet>

/* 3) 编写**单一职责**的插件。所有 ctx.* 副作用都会被自动登记，eject 时
 *    一笔勾销 —— 插件作者无需写清理代码。 -------------------------------- */
const authRequest: Plugin = {
  name: 'auth-request',
  install(ctx) {
    ctx.request((cfg) => {
      cfg.headers.set('Authorization', `Bearer ${getToken()}`);
      return cfg;
    });
  },
};

const authResponse: Plugin = {
  name: 'auth-response',
  install(ctx) {
    ctx.response(undefined, async (err) => {
      if (err.response?.status === 401) await refresh();
      return Promise.reject(err);
    });
  },
};

const logging: Plugin = {
  name: 'logging',
  install(ctx) {
    ctx.request((cfg) => { ctx.logger.log('→', cfg.method, cfg.url); return cfg; });
    ctx.response((res) => { ctx.logger.log('←', res.status, res.config.url); return res; });
  },
};

/* 4) 按你想要的执行顺序 use()。axios 原生语义：
 *      • 请求拦截器 LIFO（后 use 的先执行）
 *      • 响应拦截器 FIFO（先 use 的先执行）
 *    没有 priority 字段，顺序完全由调用方决定。 -------------------------- */
api.use(logging).use(authRequest).use(authResponse);
api.plugins();             // PluginRecord[] 快照，用于调试
api.eject('auth-request'); // 卸载该插件的拦截器 / transform / adapter / cleanup
```

---

## 快速开始

```bash
pnpm install
```

```ts
import axios from 'axios';
import Core, { create } from './src/core';

// 绑定 schema 后即可享受完整类型推断
const api = create<model.PathRefs>(
  axios.create({ baseURL: 'https://api.example.com' })
);

// 路径自动补全会按 HTTP 方法过滤
const findByStatus = api.get('/pet/findByStatus');
const pets = await findByStatus({ status: 'available' });
//    ^ Pet[]
```

如果不绑定 schema，客户端退化为薄 axios 封装 —— 路径接受任意字符串，请求/响应
默认为 `unknown`。

```ts
const api = create();              // T = unknown
const get = api.get('/whatever');  // OK，未绑 schema
const r = await get<MyType>();     // 显式泛型仍可使用
```

---

## 三种响应形态

每个派发函数都有三种返回形态，由 config 上的 flag 决定：

| Config flag       | 返回类型                                            |
|-------------------|-----------------------------------------------------|
| `{ raw: true }`   | `Promise<{ code, data: R, message? }>`（完整信封） |
| `{ wrap: true }`  | `Promise<ApiResponse<R>>`                           |
| （省略）          | `Promise<R>`（已拆包的 data）                       |

```ts
const post = api.post('/pet');

await post(payload);                     // Pet
await post(payload, { raw: true });      // { code, data: Pet, message? }
await post(payload, { wrap: true });     // ApiResponse<Pet>
```

`R` 由 `model.PathRefs` 推断而来。如需在调用点覆盖响应或请求类型，传入显式泛型：

```ts
await post<{ ok: true }, { custom: string }>({ custom: 'x' });
```

---

## 联调阶段：扩展 `model.PathRefs`

`types/paths.d.ts` 是 **codegen 产物**，永远不要手改。当某个接口尚未发布、
codegen 拿不到，但前端已经需要联调时，通过 TypeScript 的**声明合并**机制
（declaration merging）把临时路径登记进去。

1. 在 `types/local/` 下建一个新文件，例如 `types/local/draft.d.ts`：

   ```ts
   declare namespace model {
     interface PathRefs {
       '/pet/draft': {
         post: [response: model.Pet, request: [payload: model.req.AddPet]];
       };
       '/experimental/whatever': {
         // 没有 payload，response 类型未知 —— 用 unknown 强制调用点显式断言
         get: [response: unknown, request: []];
       };
     }
   }
   ```

2. 这个路径立刻就能在自动补全和类型推断中看到。

3. **接口正式发布后，删掉这个条目**。两份声明若冲突会产生 TS 编译错误，所以不会
   悄无声息地漂移。

模板已放在 [`types/local/example.d.ts.template`](./types/local/example.d.ts.template)。

> **为什么用声明合并而不是 `(string & {})` 这类宽松转义？**
> 严格的路径类型可以阻止拼写错误和"死 URL"。手写扩展文件可以 grep、可以 review，
> 也强制把进行中的接口当作一等公民登记下来 —— 接口正式上线后，从 `types/local/`
> 删除条目只是一行 PR。

---

## 插件

通过单一的 `install(ctx)` 入口扩展 axios —— adapter、拦截器、请求/响应 transformer、
任意自定义副作用都行。**所有经 `ctx` 改动的副作用都会被自动登记**，调用
`core.eject(name)` 时一笔勾销，插件作者无需自己写清理代码。

### 插件骨架

```ts
import type { Plugin } from './src/types';

const auth: Plugin = {
  name: 'auth',           // 唯一 id，core.eject() 用它定位
  install(ctx) {
    // ctx.axios   —— 直接访问 axios 实例，应付 ctx 没覆盖的高级用法
    // ctx.logger  —— 带 plugin name 标签（蓝底白字 chip）的 logger，debug 关闭时无副作用
    // ctx.name    —— plugin.name 的回显

    ctx.request((config) => {
      config.headers.set('Authorization', `Bearer ${getToken()}`);
      return config;
    });

    ctx.response(
      (res) => res,
      (err) => Promise.reject(err),
    );

    ctx.adapter(myFetchAdapter);
    ctx.transformRequest(serialize);
    ctx.transformResponse(parse);

    const timer = setInterval(refresh, 60_000);
    ctx.cleanup(() => clearInterval(timer));

    // 可选：返回一个清理函数，eject 时也会被执行
    return () => console.log('also runs on eject');
  },
};
```

> **每个插件只做一件事。** 没有 priority 字段 —— 顺序由调用方通过 `use()`
> 决定。把横切关注点拆成单一职责的小插件（例如 `auth-request` 与
> `auth-response`），调用点就是执行顺序的唯一事实来源。

### `PluginContext` API 速查

下面每一项都会把对应的副作用**自动登记**到当前安装上，`core.eject(plugin.name)`
时一笔勾销。唯一例外是 `ctx.axios` —— 它是裸的实例句柄，你直接通过它做的改动
**不会被追踪**。

| 成员 | 签名 | 卸载时还原？ |
|---|---|---|
| `ctx.axios` | `AxiosInstance` | — （逃生口，按约定只读） |
| `ctx.name` | `string` | — （`plugin.name` 的回显） |
| `ctx.logger` | `PluginLogger` | — （带 tag 的 logger，未开 `debug` 时无副作用） |
| `ctx.request(onF?, onR?, opts?)` | 注册请求拦截器 | ✓ `interceptors.request.eject(id)` |
| `ctx.response(onF?, onR?)` | 注册响应拦截器 | ✓ `interceptors.response.eject(id)` |
| `ctx.adapter(a)` | 替换 `axios.defaults.adapter` | ✓ 原 adapter 被还原 |
| `ctx.transformRequest(...fns)` | 追加到 `axios.defaults.transformRequest` | ✓ 追加进去的 fn 会被剥离 |
| `ctx.transformResponse(...fns)` | 追加到 `axios.defaults.transformResponse` | ✓ 追加进去的 fn 会被剥离 |
| `ctx.cleanup(fn)` | 注册非 axios 的清理回调 | ✓ `fn()` 被调用 |
| `install(ctx) => PluginCleanup` | install 的返回值（可选） | ✓ 在 `ctx.cleanup` 之**前**调用 |

#### 拦截器

`ctx.request` / `ctx.response` 的签名和
`axios.interceptors.{request,response}.use` 一一对应 —— 返回（可能异步的）
`config` / `response`，或者通过 `throw` / `Promise.reject` 把错误向后传。

```ts
ctx.request(
  (cfg) => { cfg.headers.set('X-Trace-Id', traceId()); return cfg; },
  (err) => Promise.reject(err),
  { synchronous: true, runWhen: (cfg) => cfg.url?.startsWith('/v2/') ?? false },
);
```

第三个参数是 axios 的 `AxiosInterceptorOptions`：

- **`runWhen(config) => boolean`** —— 谓词为 `false` 时跳过该拦截器。适合
  让某个插件只对一部分路由生效。
- **`synchronous: true`** —— 启用 axios 的同步快路径。仅当链路上**所有**
  拦截器和 adapter 都同步时才安全。

`ctx.response` 不接受 options —— 这是 axios 的限制，不是本库的。

#### 清理回调的两种写法

```ts
install(ctx) {
  const timer = setInterval(refresh, 60_000);
  ctx.cleanup(() => clearInterval(timer));   // (a) 行内注册

  return () => abortAllInflight();           // (b) install 返回值
}
```

两种都会在 eject 时执行。顺序：

1. `install` 的返回值（如果有）。
2. `ctx.cleanup` 注册的回调，按注册顺序。
3. 拦截器被 eject。
4. adapter 被还原。
5. transform 被剥离。

每个 cleanup 都被 `try/catch` 包住 —— 抛错只会输出一条日志，不会阻断后续步骤。

### 开发指南

#### 不要绕过 `ctx`

```ts
install(ctx) {
  // ✗ 错 —— 直接挂到 axios 实例上。
  //   不会被追踪，core.eject('my-plugin') 也清不掉。
  ctx.axios.interceptors.request.use(myInterceptor);

  // ✓ 对 —— 自动追踪，卸载时一并 eject。
  ctx.request(myInterceptor);
}
```

`ctx.axios` 只用来做只读探查（比如读 `defaults.baseURL`），或者处理 ctx 没
覆盖的高级用法。任何在那里做的改动得自己负责回滚 —— 通常配合 `ctx.cleanup`。

#### 状态都放在 install 闭包里

每次 install 都会重新跑一遍 `install` —— 包括 `use` / `eject` 其他插件时
触发的隐式重装。把插件本地状态放在闭包里；只有当你**确实希望**状态跨 eject
存活时，才用模块级变量。

```ts
function createRetry(max = 3): Plugin {
  return {
    name: 'retry',
    install(ctx) {
      const attempts = new WeakMap<object, number>();   // 每次 install 都是全新的
      ctx.response(undefined, async (err) => {
        const cfg = err.config;
        const n = (attempts.get(cfg) ?? 0) + 1;
        if (n > max) return Promise.reject(err);
        attempts.set(cfg, n);
        await new Promise(r => setTimeout(r, 100 * n));
        return ctx.axios.request(cfg);
      });
    },
  };
}
```

#### 错误处理

- **`install` 抛错** —— 管理器对该 record 调用 teardown（已登记的副作用全部
  回滚），从 `_plugins` 中移除该插件，再把错误抛回 `use()` 调用方。之前已经
  装好的插件不受影响。
- **某个 cleanup 回调抛错** —— 被捕获并打日志，**不**阻断后续 cleanup。
- **`use` 时遇到重名** —— 输出一条 `console.warn`（**与 `debug` 开关无关**，
  始终生效）并**静默忽略**这次 `use()`。先 use 的胜出；想换实现就先 `eject`
  旧的再装新的。warn 通道之所以绕过 `debug`，是因为重复注册是开发者必须看到
  的 bug，而不是调试信息。

#### 插件工厂模式

`Plugin` 是普通对象，但稍微复杂一点的插件都需要选项。约定是一个返回
`Plugin` 的工厂函数：

```ts
import type { Plugin } from 'http-plugins';

export interface RetryOptions { max?: number }

export function retry(options: RetryOptions = {}): Plugin {
  const max = options.max ?? 3;
  return {
    name: 'retry',
    install(ctx) { /* ... */ },
  };
}

api.use(retry({ max: 5 }));
```

选项闭包在工厂里（单一事实来源），install 体专注副作用本身。

#### 按工厂引用 eject

`core.eject` 接受三种**等价**形式 —— 内部统一退化为按 name 字符串查找：

```ts
core.eject('retry');         // 按名
core.eject(retryPlugin);     // 传 Plugin 对象  → 取 plugin.name
core.eject(retry);           // 传工厂函数      → 取 factory.name
```

工厂形式依赖一条**约定**：工厂自身的 `.name` 必须等于它返回的 `Plugin` 的
`name`。JS 会把 `function foo() {...}` 的 `.name` 自动设为 `'foo'`，所以
**只要工厂的声明名和 plugin 的 name 字符串一致**，这条约定零成本。两者不
一致时（比如 plugin 的 name 是 kebab-case 而工厂是 camelCase），显式赋值：

```ts
const name = 'http-normalize-response';
export default function normalize(opts: NormalizeOptions = {}): Plugin {
  return { name, install(ctx) { /* ... */ } };
}
normalize.name = name;   // ← 保证 factory.name === plugin.name

api.use(normalize());
api.eject(normalize);    // ← 有了上一行才能正确定位
```

三种形式归一到同一个字符串，所以 `PluginManager.eject(name)` 里**只有一条
删除路径** —— 不需要单独的 `ejectByFactory`、不需要工厂→plugin 映射、不增
加任何运行时状态。如果 `factory.name` 跟任何已安装插件都对不上，`eject`
就是个静默 no-op（行为等同于传一个不存在的字符串）。

### 生命周期

`use` 接受单个插件或数组；两种形式都返回 `this` 支持链式，可以自由混用：

```ts
import { create } from './src';

const api = create<model.PathRefs>(undefined, { debug: true });

api
  .use(authRequest)                  // 安装单个 —— ctx.* 操作被自动登记
  .use([logging, authResponse]);     // 批量安装 —— 整个数组只触发一次 #refresh

api.plugins();             // 快照：name、各类拦截器数量等
api.eject('auth-request'); // 卸载：拦截器 eject、adapter 还原、transform 剥离、cleanup 调用
api.use(authRequest);      // 重新安装 —— 整个插件集按 use() 顺序全量重装
```

数组形式相对 `#refresh` 是**原子的**：批次里所有插件先排队，然后**只在末尾
重建一次拦截器栈**。这一点在批量安装 N 个插件时尤其关键 —— 调 N 次 `use(p)`
会触发 N 次 refresh（每次都会 teardown + 重新 install 所有插件），而
`use([...])` 把整体开销保持在 O(N)。

批内的去重检查照样生效：同一个插件在数组里出现两次、或数组里某个插件已经
被安装，会得到跟单插件形式一致的 `console.warn` + 静默跳过。

`use` / `eject` 每次都会按当前 `use()` 顺序**全量重装**剩余插件，确保 axios
拦截器栈始终精确反映当前插件列表 —— 不会留下遗漏的 handler，也不会因为中间某
个插件被卸载而导致顺序漂移。

### Extends —— 派生子 `Core`

`api.extends(overrides)` 返回一个新的 `Core<T>`，初始为父的克隆，再把
`overrides` 浅合并到克隆出的 axios defaults 上面。父子**插件对象按引用共享**，
但拥有**各自独立的 axios 实例**、**各自独立的拦截器栈**、**各自独立的
`PluginManager` 记录**；调用之后两边各自演化、互不污染。

```ts
const api = create<model.PathRefs>(
  axios.create({ baseURL: 'https://api.example.com' }),
  { debug: true },
).use([auth, retry, logging]);

const v2 = api.extends({ baseURL: 'https://api.example.com/v2' });
// v2 起步时具备相同的 auth + retry + logging 栈和相同的 axios defaults，
// 只是 baseURL 不同。后续的 v2.use(...) / v2.eject(...) 完全不影响 api。
```

#### 字段级复制策略

不能一刀切：函数、sink 不能深克隆；可变数组、headers 不能浅共享。分类如下：

| 字段 | 策略 | 原因 |
|---|---|---|
| `headers` | **深** （一层进入按 method 的嵌套对象，或 `new AxiosHeaders(h)`） | `AxiosHeaders.set` 与 per-method 表是原地 mutate；共享会让子的默认头泄漏到父 |
| `transformRequest` / `transformResponse` | **深** （`asArray` 建新数组） | 插件通过 `ctx.transformRequest` 把 fn `push` 进数组；共享数组等于让子的 transform 出现在父的请求链上 |
| `params` | **深** （`{ ...params }`） | 默认 query 包用户会原地修改 |
| `transitional` | **深** （`{ ...transitional }`） | 成本可忽略，与其他可变包一致 |
| `adapter` | **按引用共享** | 函数 —— 消费侧不可变；要换 adapter 是赋新值不是 mutate |
| 原始值（`baseURL`、`timeout`、`withCredentials` …） | **按值共享** | 赋值即替换，不会 mutate |
| `CoreOptions.logger` | **按引用共享** | sink。多个 Core 共写同一个 `console` / 后端日志收集器，正是设计意图 |
| 插件**对象** | **按引用共享** | `{ name, install }` 无状态 —— `install` 每次调用建新闭包；同一个 plugin 跨 N 个 Core 复用是正确的 |
| 插件**数组**本身 | **深** （`[...parent.plugins]`） | 否则 `child.use(p)` 会跟着 mutate 父的 `#plugins` 数组 |
| `axios.interceptors`、`PluginManager` 记录 / id 数组 | **不复制** | 这些是运行时状态而非配置 —— 子重放 `useMany` 时会自动重建 |

#### 为什么需要它

- **多上下文项目** —— 主站 API + 第三方 API + 内部 admin API 通常共享
  auth/retry/loading，但 `baseURL` / headers 不同。`extends` 把这种"派生
  关系"显式表达出来，不用手工 `create + useMany([...])`，也不会漏装或顺序错乱。
- **原子性** —— 子的插件列表用一次 `useMany([...])` 重放，整个拦截器栈
  只 `#refresh` 一次，不会 O(N²)。
- **测试** —— `const mockApi = api.extends({})` 后在子上 `eject` 真 adapter
  / `use` mock adapter，生产 `api` 完全不动。

如果项目里始终只有一个 `Core` 实例，这个 API **可以不用** —— 它的价值来源于
"多个相互独立但配置高度相似的客户端"。

### 顺序语义

`use()` 顺序**就是** axios 的注册顺序，余下交给 axios 原生串行执行模型：

```
use() 顺序    请求流向（LIFO）            响应流向（FIFO）
─────────────  ─────────────────────────  ─────────────────────────
api.use(A)   ↓  内层：最后执行           内层：最先执行          ↑
api.use(B)   │  中层                     中层                    │
api.use(C)   ↓  外层：最先执行           外层：最后执行          ↑
```

- **请求拦截器** 后注册先执行。想让某插件在其他插件**之前**改 config？
  最后 `use()`。
- **响应拦截器** 先注册先执行。想让某插件在其他插件**之前**看到响应？
  最先 `use()`。
- **`transformRequest` / `transformResponse`** 按追加顺序执行 —— 先 `use()`
  的先变换。
- **`adapter`** 后 `use()` 覆盖前者；卸载时还原。

由于两侧执行方向相反，需要"请求早 + 响应也早"的语义必须**拆成两个插件** ——
一个最后 `use()`（管请求），一个最先 `use()`（管响应）。

### 实战示例

#### Auth —— 注入 token + 401 自动刷新

两个单一职责插件，调用点决定顺序。

```ts
const authRequest: Plugin = {
  name: 'auth-request',
  install(ctx) {
    ctx.request((cfg) => {
      const t = tokenManager.accessToken;
      if (t) cfg.headers.set('Authorization', `Bearer ${t}`);
      return cfg;
    });
  },
};

const authResponse: Plugin = {
  name: 'auth-response',
  install(ctx) {
    let pending: Promise<void> | null = null;       // 并发刷新去重
    ctx.response(undefined, async (err) => {
      if (err.response?.status !== 401 || !tokenManager.canRefresh) {
        return Promise.reject(err);
      }
      pending ??= refresh().finally(() => (pending = null));
      await pending;
      return ctx.axios.request(err.config);          // 用新 token 重试一次
    });
  },
};

api.use(authResponse)   // FIFO ⇒ 响应阶段最先跑 → 抢先捕获 401
   .use(authRequest);   // LIFO ⇒ 请求阶段最先跑 → 注入 Authorization
```

#### Loading 指示器 —— 请求计数

```ts
const loading: Plugin = {
  name: 'loading',
  install(ctx) {
    let count = 0;
    const inc = () => { if (++count === 1) showSpinner(); };
    const dec = () => { if (--count === 0) hideSpinner(); };

    ctx.request((cfg) => { if (cfg.loading !== false) inc(); return cfg; });
    ctx.response(
      (res) => { if (res.config.loading !== false) dec(); return res; },
      (err) => { if (err.config?.loading !== false) dec(); return Promise.reject(err); },
    );

    ctx.cleanup(() => { count = 0; hideSpinner(); });   // 飞行中 eject 的兜底
  },
};
```

#### 条件拦截器 —— `runWhen`

让插件只对子集路由生效，handler 里不用再写分支。

```ts
const idempotency: Plugin = {
  name: 'idempotency',
  install(ctx) {
    ctx.request(
      (cfg) => { cfg.headers.set('Idempotency-Key', crypto.randomUUID()); return cfg; },
      null,
      { runWhen: (cfg) => cfg.method === 'post' && !cfg.url?.startsWith('/auth/') },
    );
  },
};
```

#### 自定义 adapter —— 测试期 mock

```ts
const mockAdapter: Plugin = {
  name: 'mock-adapter',
  install(ctx) {
    ctx.adapter(async (config) => {
      const fixture = await loadFixture(config.url!);
      return { data: fixture, status: 200, statusText: 'OK', headers: {}, config };
    });
  },
};

if (import.meta.env.MODE === 'test') api.use(mockAdapter);
```

`api.eject('mock-adapter')` 还原原 adapter —— 测试中需要在 mock 与真网络之间
切换时很方便。

### 调试

`new Core(axios, { debug: true })`（或 `create(_, { debug: true })`）开启后，
每一次插件动作 —— install、eject、拦截器添加/删除、adapter 替换、transform 追加 ——
都会经过带标签的 logger 输出。tag 部分（`[http-plugins]` / `[http-plugins]
[<plugin>]`）会以**蓝底白字**胶囊样式渲染 —— 浏览器 DevTools 用 `%c` CSS，
Node 终端用 ANSI SGR (`\x1b[44;97m`) —— 在嘈杂的 console 里一眼能看到：

```
[http-plugins] use "auth-request"
[http-plugins] [auth-request] request interceptor #0 +
[http-plugins] use "auth-response"
[http-plugins] [auth-response] response interceptor #0 +
[http-plugins] use "http-normalize"
[http-plugins] [http-normalize] response interceptor #1 +
[http-plugins] eject "auth-request"
[http-plugins] [auth-request] -1 request interceptor
```

通过 `{ debug: true, logger: myLogger }` 可以替换默认的 console（任何带
`log/warn/error` 三个方法的对象即可）。如果不想开 debug 但要做运行时自省，
调用 `core.plugins()` 拿 `PluginRecord[]` 快照即可。

### 内置插件

| 插件 | 说明 |
|---|---|
| [`normalize`](./src/plugins/normalize.ts) | 把 `response.data.data` 提升为 `response.data`（拆信封） |
| [`normalizeStrict`](./src/plugins/http-normalize-plugin.ts) | 把响应体包装为 `ApiResponse` 实例，`successful === false` 时直接 reject |

---

## 架构

```
src/
├── core.ts              # Core<T> 类 + create() 工厂 + 派发函数构建
├── plugin.ts            # PluginManager —— install/eject 生命周期、
│                        # 拦截器 / transform / adapter 副作用追踪
├── helper.ts            # 公共工具（logger、asArray、tagged、NS）
├── types.ts             # 全部类型工具 + HttpPrototype<T> 顶层助手
├── objects/             # 运行时模型类
└── plugins/             # 内置插件

types/
├── paths.d.ts           # Codegen 产物 —— 不要修改
├── request.d.ts         # Codegen 产物 —— 不要修改
├── response.d.ts        # Codegen 产物 —— 不要修改
└── local/               # 手写扩展（声明合并）
```

`Core<T>` 只消费 `src/types.ts` 导出的一个顶层助手 `HttpPrototype<T>`。内部将
schema 反转为 method-major 视图（`_Indexed<T>`），让每个调用点的查找退化为
O(1) 字面量属性访问，避免在 1000+ 路径上反复跑 mapped+conditional。

### 已应用的类型性能优化

- **Method-major 反转**（`_Indexed<T>`）按 `T` 缓存计算一次，后续每个
  `core.<verb>(path)` 调用点都是直接属性查找。
- **严格路径类型** —— 不引入 `(string & {})` 字面量逃生通道，自动补全联合更小、
  渲染更快。
- **非分发条件守卫** `[X] extends [Y]`，避免在联合成员上扇出。
- **三条 overload 共享一次 payload/response 推断**，靠捕获后的字面量 `P` 复用。

若 schema 超过 1000 路径仍感到 IDE 卡顿，可以按业务域拆分多个 `Core<DomainRefs>`
实例（每个域一份）。详见 PR 历史的性能讨论。

---

## API 速查

### `create<T = unknown>(axiosInstance?): Core<T>`

包装 axios 实例的工厂函数。传入 schema 泛型即可启用类型化路径。

### `class Core<T = unknown>`

每个 HTTP 动词暴露一个方法：`get`、`post`、`put`、`delete`、`patch`、`head`、
`options`。签名为 `(path, config?)`，返回派发函数。

### 派发函数 overload

```ts
fn(payload?, config?)                       → Promise<R>
fn(payload?, { ...config, raw: true })      → Promise<{ code, data: R, message? }>
fn(payload?, { ...config, wrap: true })     → Promise<ApiResponse<R>>
```

`payload` 是否必填取决于 schema 条目的 `request` 元组形态：`[Payload]` 必填、
缺省可选、`[]` 不接受 payload。

### 类型导出

完整类型表面位于 [`src/types.ts`](./src/types.ts)。对外有意义的只有：

- `HttpPrototype<T>` —— `Core<T>` 实例的方法形状
- `HttpMethodLower` —— `'get' | 'post' | ...`
- `Plugin`、`HttpPluginsBaseOptions`、`HttpPluginsMethodOptions`、
  `HttpPluginsRuntimeOptions`、`NormalizeOptions`

---

## 开源协议

MIT
