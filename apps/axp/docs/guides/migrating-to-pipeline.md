---
title: 从旧版迁移到洋葱管线
status: active
updated: 2026-10-29
summary: 旧写法到新写法的逐项对照：入口、错误、返回形态、删除的插件、默认值与回调签名的变化
---

## TL;DR

- 入口换成 `createAxp`，插件只对 axp 客户端生效。`Axp.install`、`Axp.create`、`Core` 删除，裸 `axios` 实例上不再有插件。
- 失败不再是 `ApiError` 或 `AxiosError`，而是抛出归一化响应 `IAxpResponse`。判断用 `api.isResponse(e)`，需要 `Error` 时用 `reject` 适配。
- `raw: true` 改为 `wrap: true` 后读 `r.raw`；`normalize: false` 改为 `throws: false`。
- `axpCancel`、`axpKey`、`axpLogger`、`axpNormalize` 删除，能力并入内核。retry、filter、cache 的默认值变了，升级后要复查这几个插件的行为。
- 下面按"旧代码 → 新代码"逐项对照。删除的子路径在第 11 节，删除的类型在第 13 节。

## 0.2.0 终审后的变化

下面的“旧”指 2026-10-29 终审前的 0.2.0 工作区；后面的各节已按终审后的 API 更新。决策理由见 [ADR 0002](../decisions/0002-response-contract.md)。

| 旧写法或假设                                       | 新写法                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `r.kind`、`r.reason`、`AXP_KINDS`                  | `failureOf(r)?.type` / `.reason`、`AXP_FAILURES`；取消用 `api.isCancel(e)` / `isAxpCancel(e)`。HTTP/业务失败本身没有标记，看 ok/status/code                        |
| `r.httpStatus`                                     | `r.status`，只表示 HTTP 状态，无响应为 0                                                                                                                           |
| 逻辑状态自动把 HTTP 200 加业务码当 401/403/5xx/429 | 自己配置 onFailure、shouldRetry、respectRetryAfter；[完整示例及警告](../../README.zh-CN.md#使用警告与业务风格)                                                     |
| `axpResponse({ envelope })`                        | 覆盖 AxpResponse.parse(body, raw)，用 axpResponse({ type: MyResponse })；接口实现走 create                                                                         |
| `key.ignores`、`key.sample`                        | 删除，只留 scope；对象只跳过 undefined，null 字段及其它值参与，字符串不 trim；旧持久化 key 需要清理                                                                |
| store 保存 `{ response: R, expiresAt }`            | 保存 `{ snapshot, expiresAt }`，方法可返回 Promise、size 可选；命中经工厂重建，request 是当前调用方；[快照接口](../design/plugin-spec.md#63-cachesource内置次序-3) |
| 同步使用 remove/clear/removeCache/clearCache       | 统一 await，返回 MaybePromise；get 失败按未命中，写删异常隔离并 console.error                                                                                      |
| retryAfterMax 默认 Infinity，超限封顶后仍重试      | 默认 60_000，服务端要求超过上限就不重试；Infinity 表示永远照办                                                                                                     |
| onRefresh 可以一直挂起                             | refreshTimeout 默认 30_000，0/Infinity 不限时；同客户端刷新必须 protected: false，超时只是兜底                                                                     |
| extend() 会保留拦截器                              | 默认只复制 defaults 并新建 axios；保留拦截器传 extend(overrides, { axios })，显式实例不复制父 defaults                                                             |
| 已发送的流能自动重放                               | retry/auth/mock 返回原响应；自定义插件在重放前查 ctx.canReplay()，强行重放会抛原始 Error                                                                           |

默认 code 为 0、data 为 null、message 为空串（允许 null），message/raw/error 是可选接口字段。request/stack 仅默认类提供。自定义 create 在缓存重建时没有 raw，应从 init 恢复扩展字段。

## 1. 入口

旧：

```ts
import axios from "axios";
import { Axp, axpKey, axpCache, axpRetry } from "@codejoo/axp";

const api = Axp.create<Schema>(axios.create({ baseURL: "/api" }));
Axp.install(api.axios, { key: axpKey(), cache: axpCache(), retry: axpRetry({ max: 2 }) });
```

新：

```ts
import axios from "axios";
import { createAxp, axpCache, axpRetry } from "@codejoo/axp";

const api = createAxp<Schema>({
  axios: axios.create({ baseURL: "/api" }),
  plugins: [axpRetry({ max: 2 }), axpCache()], // 插件顺序不用排，内置插件位置固定
});
```

要点：

- `key` 不再是插件。它是内核服务，需要改配置时写在 `createAxp({ key: { scope } })` 里。
- 插件数组的顺序不影响内置插件的执行顺序。只有自定义插件才需要关心 `stage` 和 `enforce`。
- 类型参数 `T` 换成 `S`（接口类型），仍然是 `createAxp<S>()`。要自定义响应类时，`S` 和 `R` 都要写出来。

## 2. 错误处理

旧：

```ts
try {
  await api.post("/pet")(body);
} catch (e) {
  if (e instanceof ApiError)
    toast(e.message, e.response.code); // 业务失败
  else if (axios.isAxiosError(e) && e.response?.status === 401) relogin();
  else if (axios.isAxiosError(e))
    toast(e.message); // 网络、超时等
  else throw e;
}
```

新：

```ts
import { failureOf } from "@codejoo/axp";

try {
  await api.post("/pet")(body);
} catch (e) {
  if (api.isResponse(e)) {
    if (failureOf(e)?.type === "auth")
      relogin(); // 或者判断 e.status === 401
    else toast(e.message, e.code);
  } else {
    throw e; // 程序 bug，原样抛出
  }
}
```

要点：

- 可预期的失败（HTTP、业务、网络、超时、取消、解析、鉴权）全部抛出 `IAxpResponse`。它不是 `Error`，默认没有 `stack`。
- 内核失败读 failureOf(e)?.type / reason；HTTP 状态读 e.status，业务码读 e.code。取消用 api.isCancel(e)。先从包根导入 failureOf；原来的 e.response 不再存在。
- 程序 bug 仍然抛原始异常。`api.isResponse(e)` 用来区分两者。
- 需要 `Error` 的生态（Sentry、TanStack Query 等）在客户端配置 `reject`：

  ```ts
  const api = createAxp<Schema>({
    reject: (r) => Object.assign(new Error(r.message ?? ""), { response: r }),
  });
  ```

  `reject` 只作用于可预期的失败。

## 3. 成功判定

旧，全局可变：

```ts
AxpResponse.isSuccessful = (status, code) => code === 200;
```

新，每个客户端一份，子类覆盖 `ok`，字段转换覆盖 `parse`：

```ts
import { AxpResponse, axpResponse, createAxp } from "@codejoo/axp";

class MyResponse<D = unknown> extends AxpResponse<D> {
  get ok() {
    return this.status >= 200 && this.status < 300 && this.code === 200;
  }
}

const api = createAxp<Schema, MyResponse>({
  response: axpResponse<MyResponse>({ type: MyResponse }),
});
```

要点：

- status 保持 HTTP 状态；内核失败标记强制 ok 为 false。
- `AxpResponse.fromResponse` 删除。响应由工厂构造，不需要手动调用。
- 旧的 `successful` 字段改为 `ok`。

## 4. 返回形态

旧：

```ts
const env = await api.get("/pet")(undefined, { raw: true }); // 完整信封 { code, data, message }
const out = await api.get("/pet")(undefined, { wrap: true }); // AxpResponse 实例
const r = await api.get("/pet")(undefined, { normalize: false }); // 不归一化
```

新：

```ts
const r = await api.get("/pet")(undefined, { wrap: true }); // r.data 是业务数据，r.code、r.message 也在
r.raw; // 原始 AxiosResponse

const res = await api.get("/pet")(undefined, { throws: false }); // 失败不抛出，res.ok 为 false
```

要点：

- `raw: true` 删除。原来拿到的信封字段现在直接在 `r` 上：`r.code`、`r.message`、`r.data`。
- `normalize: false` 改为 `throws: false`。注意语义不完全一样：成功判定仍然生效，只是失败变成 resolve 出 `ok` 为 `false` 的结果，而不是抛出。
- `wrap: true` 成功时返回带业务类型的 `WithData<R, D>`，失败仍然抛出。

## 5. 删除的插件及替代

| 旧                                                                           | 新                                                                                                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `axpCancel()` 加 `cancelAll(ax, reason)`                                     | 内核自带。用 `api.cancelAll(reason)`。`signal` 照常可用                                                                                 |
| `axpKey({ fastMode, before, after, ignores, sample, scope })` 加 `key: true` | 内核服务。`createAxp({ key: { scope } })`。`fastMode`、`before`、`after` 删除。请求级 `key` 省略即自动计算；`true` 与省略等价，保留兼容 |
| `axpLogger({ debug, logger })`                                               | `createAxp({ debug })`，`debug` 可以是 `true` 或自定义 logger                                                                           |
| `axpNormalize({ nullable })`                                                 | 内核落定，不需要安装。`nullable` 删除，`data` 为 `null` 或 `undefined` 时照常原样返回                                                   |

key 的例子：

```ts
// 旧
Axp.install(axiosInstance, { key: axpKey({ fastMode: false, scope: () => session.userId }) });
api.get("/list")(undefined, { key: true, cache: true });

// 新：scope 仍然可以是函数，每次算 key 时求值，切换账号不用重建客户端
const api = createAxp({ key: { scope: () => session.userId } });
api.get("/list")(undefined, { cache: true });
```

`scope` 可以是字符串、数字，或者函数 `(request) => 值`。写成静态值（`scope: session.userId`）的话，只在创建客户端那一刻取值，之后切换账号不会更新，需要切换账号的场景请用函数。返回 `null`、`undefined`、空串或 `NaN` 时不附加。

## 6. 各插件的选项与默认值变化

| 插件         | 变化                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axpRetry`   | `max` 默认 0 改为 2。`delay` 默认 3000 改为指数退避 `attempt => 300 * 2 ** (attempt - 1)`。`delayMax` 默认 `Infinity` 改为 `10_000`。`shouldRetry` 签名改为 `(r, attempt, ctx)`。`statusCodes`、`afterStatusCodes` 改为对照 HTTP 状态 r.status，业务码判定需显式配置 |
| `axpFilter`  | 装上即生效。旧版要请求级写 `filter: true` 才过滤，现在要关闭才写 `filter: false`。请求级只接受 `false`、`true` 和对象，不再调用函数                                                                                                                                  |
| `axpCache`   | 默认只缓存 GET 和 HEAD。`shouldCache` 参数改为 `r`。`storage`、`memory` 选项删除，持久化走 `store`。命中时不再重跑 `transformResponse`                                                                                                                               |
| `axpShare`   | 策略 `'none'` 删除，改用 `share: false`。`share: (config) => …` 删除。race 的胜负改看 `r.ok`。新增 `methods`，默认 GET 和 HEAD。跟随者拿到同一个只读的 `R`                                                                                                           |
| `axpMock`    | `fallbackWhen` 参数改为 `r`。请求级对象里的 `mock` 字段删除，关闭用 `false` 或 `{ enable: false }`。`mock: true` 仍然可以为单次请求开启                                                                                                                              |
| `axpNotify`  | `stringify` 签名改为 `(r, ctx)`，并且有默认值，可以不写。`silent: true` 真正生效（只作用于默认的 `stringify`，自定义的自己读 `ctx.request.silent`）。请求级 `notify` 只是开关：`false` 或 `{ enable: false }`                                                        |
| `axpLoading` | 显示从逻辑请求开始算，包括等待 token 刷新的时间。`guardTransform` 和 `logical` 参数删除。请求级回调（函数形式）保留                                                                                                                                                  |
| `axpRepath`  | 行为不变。占位符值按路径段编码，只替换 pathname。请求级除了 `false`，还可以写对象 `{ pattern, removeKey }` 覆盖                                                                                                                                                      |
| `key`        | 包含 params，有请求体的方法还包含 data。旧版 `key: true` 只哈希 method 和 url，同一路径不同参数会串缓存                                                                                                                                                              |
| `axpEnvs`    | 卸载（`eject`、`dispose`）不再还原写入 `defaults` 的配置，旧版的 cleanup 会还原。另可写成 `{ enable, rules }`，数组写法仍然可用                                                                                                                                      |

retry 的例子：

```ts
// 旧：默认不重试，3 秒固定间隔
axpRetry({ max: 3 });

// 新：默认重试 2 次，指数退避；想保持旧的固定间隔要显式写 delay
axpRetry({ max: 3, delay: 3000, delayMax: Infinity });
```

cache 的例子：

```ts
// 旧：POST 也会被缓存
api.post("/search")(body, { cache: true });

// 新：POST 不会被缓存。要缓存只能在插件级改 methods
axpCache({ methods: ["get", "head", "post"] });
api.post("/search")(body, { cache: true });
```

## 7. auth

旧：

```ts
axpAuth({
  tokenManager,
  onRefresh: (tm, resp) => refresh(tm),
  onAccessExpired: (tm, resp) => logout(),
  onAccessDenied: (tm, resp) => toast("无权限"),
  accessDeniedCode: "ACCESS_DENIED",
  ready: (tm, config) => {
    config.headers.Authorization = tm.accessToken;
  },
});
```

新：

```ts
axpAuth({
  tokenManager,
  onRefresh: (r, tm) => refresh(tm),
  onAccessExpired: (r, tm) => logout(),
  onAccessDenied: (r, tm) => toast("无权限"),
  ready: (tm, request) => ({ headers: { Authorization: tm.accessToken } }),
});
```

要点：

- 回调参数统一为 `(r, tm)`。`onFailure` 收到的是 `R`，不再是 `AxiosResponse`。
- `canRefresh` 删除。`tokenManager.canRefresh` 不存在了，`TokenManager` 上也没有这个属性。判定过期后，插件会清空 token 并记下清空后的状态，这个状态没变之前不再刷新、不再重复通知过期。登录写入新 token 后自动恢复，登录流程不需要再手动改标记。
- `config.authExpired` 标记删除，改为看 `failureOf(r)?.reason === 'expired'`。
- 没有 token 时，不再合成 `data.code === 'ACCESS_DENIED'` 的响应。改为判断 `failureOf(r)?.type === 'auth' && failureOf(r)?.reason === 'unauthenticated'`。`accessDeniedCode` 选项和 `ACCESS_DENIED_CODE` 常量删除。
- `ready` 返回一个 `AxpRequestPatch`，不再直接修改 `config`。
- `authFailureFactory` 删除，默认路由改为 `defaultAuthFailure`，按状态键识别携带的 token，不再解析请求头。原来的 `DEFAULT_ON_AUTH_FAILURE` 由它取代。
- 尝试钩子 `registerAttemptHook` 删除。retry 的每次尝试本来就会经过 auth。
- `AuthFailureAction` 有五个动作：`Refresh`、`Replay`、`Deny`、`Expired`、`Others`。第五个 `Others`（值为 `'others'`）表示与鉴权无关的失败，原样返回；`onFailure` 返回 `null`、`undefined` 或不认识的值时效果相同。
- 本地没有 token 时，每个受保护请求都会调用一次 `onAccessDenied`，没配就回退到 `onAccessExpired`，不去重。旧版也是这样；"每一轮只通知一次"只管 401、刷新失败那条路径。
- 根入口导出了 `defaultAuthFailure` 和 `AuthFailureAction`（`@codejoo/axp/auth` 子路径里也有）。自定义 `onFailure` 只想改个别情况、其余沿用默认判定时，可以直接调用 `defaultAuthFailure(r, tm, ctx)`：

  ```ts
  import { AuthFailureAction, defaultAuthFailure } from "@codejoo/axp";

  axpAuth({
    tokenManager,
    onFailure: (r, tm, ctx) => (r.code === "SESSION_KICKED" ? AuthFailureAction.Expired : defaultAuthFailure(r, tm, ctx)),
    onRefresh: (r, tm) => refresh(tm),
    onAccessExpired: (r, tm) => logout(),
  });
  ```

## 8. 请求选项不再接受函数

旧：

```ts
api.get("/list")(undefined, { key: () => "k", cache: { key: (cfg) => cfg.url } });
api.get("/x")(undefined, { share: (cfg) => (cfg.url.startsWith("/a") ? "start" : false) });
api.get("/x")(undefined, { retry: () => 2 });
```

新：

```ts
api.get("/list")(undefined, { key: "k", cache: { key: "list" } }); // 显式字符串 key
const shareable = url.startsWith("/a"); // 在调用处判断
api.get("/x")(undefined, { share: shareable ? "start" : false });
```

例外：本身就是回调的选项仍然可以传函数，比如 `axpLoading` 的请求级回调。

## 9. extend 继承插件

旧：

```ts
const child = api.extends({ baseURL: "/v2" }); // 不带插件
Axp.install(child.axios, { cache: axpCache() }); // 要自己再装一遍
```

新：

```ts
const child = api.extend({ baseURL: "/v2" }); // 默认继承插件，每个插件各自重新 setup，状态不共享

const other = api.extend({ baseURL: "/v2" }, { plugins: [axpCache()] }); // 或者指定插件列表
```

要点：

- `extends` 改名为 `extend`。
- 默认行为反过来了：旧版派生的实例不带插件，新版默认继承。缓存、token 刷新这些状态各自独立，不会串。

## 10. 插件生命周期 API

| 旧                                                        | 新                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Axp.install(ax, {...})` 返回 `AxpHandle`                 | `createAxp({ plugins })`；运行时用 `api.use(p)` 和 `api.eject(name)`                                                |
| `handle.plugin('axp:cache')`，按名字取                    | `api.plugin(cachePlugin)`，传插件对象，不是名字                                                                     |
| `handle.prepend`、`append`、`insertBefore`、`insertAfter` | 删除，不再支持手动排序。内置插件位置固定，自定义插件用 `stage` 和 `enforce`                                         |
| `handle.dispose()`                                        | `api.dispose()`：先中止在途请求，再卸载全部插件，销毁后客户端不能再用；只卸一个用 `api.eject(name)`，不影响在途请求 |
| 插件的 `install(axios)` 返回 cleanup                      | `setup(client)` 返回实例，实例上可以有 `handle`、`taps`、`api`、`dispose`                                           |
| 插件写成拦截器                                            | 写成中间件 `handle(ctx, next)`，或用 `taps` 挂到多个阶段。`next()` 不抛错，返回 `R`                                 |
| `pluginLog(config, ...)`                                  | `ctx.log`                                                                                                           |
| `Plugin` 类型                                             | `AxpPlugin` 类型                                                                                                    |

## 11. 子路径删除

| 旧                       | 新                       |
| ------------------------ | ------------------------ |
| `@codejoo/axp/cancel`    | 删除。用 `api.cancelAll` |
| `@codejoo/axp/key`       | 删除。key 是内核服务     |
| `@codejoo/axp/logger`    | 删除。用 `debug` 选项    |
| `@codejoo/axp/normalize` | 删除。归一化由内核完成   |

这四个子路径已经从 `exports` 里删掉，也没有产物文件，导入会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

保留的子路径是 10 个插件各自的 `./<name>`：`auth`、`cache`、`envs`、`filter`、`loading`、`mock`、`notify`、`repath`、`retry`、`share`，以及单文件压缩版 `./min`。`package.json` 的 `exports` 另有根入口 `.` 和 `./package.json`，一共 13 项。

- 插件子路径默认导出对应的工厂（`axpRetry` 等）；`./auth` 另外导出 `AuthFailureAction` 和 `defaultAuthFailure`，`./cache` 另外导出 `removeCache` 和 `clearCache`。它们和根入口给出的是同一份函数，混着导入没问题。
- `./min` 是单文件压缩版，自带一份模块实例，类型沿用根入口。和根入口混用时 `isAxpResponse` 仍能互认，但插件状态和客户端实例不共享，一个应用里选一个用。
- 插件内部的算法模块（`retry-timing`、`auth-match`、`cache-store`）不在 `exports` 里，包外导入不了。

## 12. 其它删除或改名

| 旧                                         | 新                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `ApiError`                                 | 删除。失败是 `IAxpResponse`                                                                        |
| `AxpResponse.fromResponse(res)`            | 删除，由响应工厂构造                                                                               |
| `AxpResponse.isSuccessful` 静态钩子        | 子类覆盖 `ok` 和 `status`                                                                          |
| `res.successful`                           | `r.ok`                                                                                             |
| `cancelToken`                              | 删除，用 `signal`                                                                                  |
| `removeCache(ax, key)`、`clearCache(ax)`   | `removeCache(client, key)`、`clearCache(client)`，参数改为客户端。没装 cache 时返回 `false` 和 `0` |
| cache 的 `storage`、`memory` 选项          | 删除。持久化用 `store`                                                                             |
| `shouldCache(response)`                    | `shouldCache(r)`                                                                                   |
| `stringify(data, message, status, config)` | `stringify(r, ctx)`                                                                                |
| `fallbackWhen({ response, error })`        | `fallbackWhen(r)`                                                                                  |
| `shouldRetry(response?, err?)`             | `shouldRetry(r, attempt, ctx)`                                                                     |
| `nullable` 选项                            | 删除。运行时本来就没有效果                                                                         |
| 请求级 `key: true`                         | 可以保留：与省略等价，都是自动计算（新版自动计算包含参数）。数字、函数形式不再支持                 |
| `Axp.create<T>` 的 `T`                     | `createAxp<S>` 的 `S`                                                                              |
| `Core` 类                                  | `AxpClient`，由 `createAxp` 创建                                                                   |

## 13. 已删除的类型

旧版 `src/types.ts` 里的这些类型都服务于拦截器时代的 `Core` 和 `Axp.install`，已经删除。它们原先都能从 `@codejoo/axp` 导入，用到的代码会编译失败，按下表替换：

| 旧类型                         | 新写法                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `Plugin`                       | `AxpPlugin`：`{ name, stage, setup, handle, taps }`                                                       |
| `PluginCleanup`                | 无独立类型。需要清理时，在 `setup` 返回的实例上写 `dispose()`                                             |
| `PluginLogger`                 | 并入 `AxpLogger`，成员不变，仍是 `log`、`warn`、`error`                                                   |
| `CoreOptions`                  | `AxpOptions`，即 `createAxp` 的选项                                                                       |
| `ICommonOptions`               | 无。它是旧插件往请求选项上加字段的空接口，现在扩展 `AxpRequestOptions`（`declare module '@codejoo/axp'`） |
| `IPluginCommonRequestOptions`  | 无，已无对应概念。它只给 `axpKey` 的 `before`、`after` 用，两者随 `axpKey` 一起删除                       |
| `IPluginCommonResponseOptions` | 无，已无对应概念。本来就是没启用过的空占位                                                                |
| `IBaseOptions`                 | `AxpRequestConfig`                                                                                        |
| `IMethodOptions`               | `AxpRequestConfig`，`api.get(path, config)` 的方法配置也是这个类型                                        |
| `IHttpOptions`                 | `AxpRequestConfig`。`wrap`、`throws` 已经在里面，`raw`、`nullable` 删除                                   |
| `IInnerOptions`                | 无，已无对应概念。`_debug`、`_logger` 删除，调试开关用 `createAxp({ debug })`，插件里用 `ctx.log`         |
| `NormalizeOptions`             | 无，已无对应概念。归一化由内核完成，没有 `normalize` 选项                                                 |
| `HttpInternalRequestConfig`    | 无，已无对应概念。key 不再写在请求配置上，插件里调 `ctx.key()` 取                                         |
| `HttpPrototype<T>`             | `HttpVerbs<S, R>`，即 `AxpClient` 上的十个动词；一般直接写 `AxpClient<S, R>`                              |
| `Primitive`                    | 无，已无对应概念                                                                                          |
| `MaybeFun`                     | 无，已无对应概念。请求选项不再接受函数，见第 8 节                                                         |
| `Falsy`                        | 无，已无对应概念                                                                                          |

`MethodSchema` 和 `HttpMethodLower` 保留不变，Schema 推断的写法照旧。

## 迁移检查清单

- [ ] 所有 `Axp.install`、`Axp.create`、`Core` 换成 `createAxp`。
- [ ] `catch` 里的 `ApiError`、`AxiosError` 判断换成 `api.isResponse(e)` 加 failureOf(e)，取消用 api.isCancel(e)。
- [ ] 搜索 `raw: true`、`normalize`、`successful`、`canRefresh`、`accessDeniedCode`、`authExpired`，逐个替换；`key` 的数字、函数写法改成字符串或省略。
- [ ] 检查 retry：默认次数和间隔变了，依赖旧默认值的地方要显式写回去。
- [ ] 检查 filter：之前没写 `filter: true` 的请求，现在会被过滤。
- [ ] 检查 cache：有没有 POST 依赖缓存，需要的话改 `methods`。
- [ ] 请求选项里的函数形式，改为调用处判断或字符串 key。
- [ ] 需要 `Error` 的上报或状态库，配置 `reject`。
- [ ] 删除 `./cancel`、`./key`、`./logger`、`./normalize` 子路径的引用。
- [ ] 搜索 `IHttpOptions`、`IMethodOptions`、`HttpPrototype`、`Plugin`、`PluginLogger` 等旧类型名，按第 13 节替换。
- [ ] 登出和切换账号时，清理缓存（`clearCache`）并确认 key 的 scope 正确。
- [ ] 派生实例（`extend`）现在默认带插件，确认是否符合预期。
