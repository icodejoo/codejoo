---
name: codejoo-axp
description: 在 apps/axp（@codejoo/axp）里使用客户端、编写插件或修改源码时使用。覆盖洋葱管线、四字段响应契约、内核失败标记、请求重放、缓存快照与项目不变量；旧 Axp.install/Axp.create API 已删除。
---

# @codejoo/axp

基于 axios 的插件式 HTTP 客户端。`createAxp()` 造客户端；一次调用是一个逻辑请求，从外到内穿过 5 个阶段的中间件，最里面一层才调 `axios.request`。设计导读看 `ARCHITECTURE.md`，选项表看 `README.md` / `README.zh-CN.md`，规格看 `docs/design/`，旧写法迁移看 `docs/guides/migrating-to-pipeline.md`。

## 用法

```ts
import axios from "axios";
import { createAxp, axpRepath, axpRetry, axpAuth, axpCache, axpNotify, TokenManager } from "@codejoo/axp";
import type { Schema } from "./api-schema"; // 方法优先：{ get: { "/pet/{id}": [response, [payload]] } }

const api = createAxp<Schema>({
  axios: axios.create({ baseURL: "/api" }),
  plugins: [
    axpRepath(), // 填路径里的 {id}
    axpRetry({ max: 2 }),
    axpAuth({
      tokenManager: new TokenManager(),
      onRefresh: (r, tm) => refreshToken(tm), // 返回 false 或抛错算刷新失败
      onAccessExpired: () => redirectToLogin(),
    }),
    axpCache({ expires: 30_000 }), // 按请求开启
    axpNotify({ notify: (msg) => toast.error(msg) }),
  ],
});

const pet = await api.get("/pet/{id}")({ id: 1 }); // 成功直接得到业务 data
const list = await api.get("/pet/findByStatus")({ status: "available" }, { cache: true });
```

- 动词是 axios 的 10 个小写方法。`delete`、`post`、`put`、`patch` 的 payload 走 `data`，其余走 `params`。`api.request<D>(config)` 是无类型的逃生口。
- `S` 省略时路径退化为 `string`。自定义响应类型 `R` 时 `S` 和 `R` 都要写，TS 不做部分推断。需要 TypeScript ≥ 5.4。

## 阶段与内置插件

| 阶段         | 内置插件（外 → 内）                 | 说明                                          |
| ------------ | ----------------------------------- | --------------------------------------------- |
| `outer`      | `axpLoading` → `axpNotify`          | 整个逻辑请求进出一次，看到最终结果            |
| `prepare`    | `axpRepath` → `axpFilter`           | 请求整形，只跑一次                            |
| `attempt`    | `axpRetry`                          | 重试边界，往里每次尝试都重跑                  |
| `credential` | `axpAuth`                           | 注入 token，401 时刷新并重放                  |
| `source`     | `axpMock` → `axpShare` → `axpCache` | 结果来源，可以不触网直接返回                  |
| 无           | `axpEnvs`                           | 只有 `setup`：装上时把配置写进 axios defaults |

内置插件的位置由名字（`axp:<name>`）固定在 `src/stages.ts`，`plugins` 数组的顺序不影响它们。装上即生效，例外是 `cache`、`share`（按请求开启）和 `mock`（默认关闭）。`api.inspect()` 返回解析后的顺序 `[{ stage, name }]`。

## 请求级选项的四种写法

每个插件都一样：

| 写法          | 含义                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `false`       | 本次关闭                                                                                                          |
| `true` 或省略 | 用插件级配置                                                                                                      |
| 简写          | 各插件自己规定，只覆盖主参数：retry 的数字、cache 的数字（`expires`）、share 的策略字符串、loading 的回调         |
| 对象          | 按字段覆盖，请求级 > 插件级 > 内置默认；`null` / `undefined` 表示继承；数组整体替换；`enable: false` 等同 `false` |

```ts
api.get("/list")(undefined, { cache: true });
api.get("/list")(undefined, { cache: 10_000 }); // 简写：expires
api.get("/list")(undefined, { cache: { expires: 10_000, key: "pets" } });
api.get("/list")(undefined, { retry: false, share: "race" });
```

不接受函数形式（本身就是回调的选项除外，比如 loading 的请求级回调）。内核自带的请求选项是 `wrap`、`throws`、`silent`、`key`、`signal`；插件的请求选项靠 `declare module '@codejoo/axp' { interface AxpRequestOptions { … } }` 扩展。

## 返回形态与错误

| 调用                | 成功                                       | 可预期的失败                            |
| ------------------- | ------------------------------------------ | --------------------------------------- |
| 默认                | 返回 `data`                                | `throw r`，`r` 是 `IAxpResponse`        |
| `{ wrap: true }`    | 返回 `WithData<R, D>`（`r.data`、`r.raw`） | 同上，照抛                              |
| `{ throws: false }` | 返回 `WithData<R, D>`                      | 不抛，resolve 出 `ok` 为 `false` 的 `r` |

```ts
try {
  await api.post("/pet")(body);
} catch (e) {
  if (api.isResponse(e))
    toast.error(e.message); // 可预期的失败
  else throw e; // 程序 bug，原样抛出
}
const res = await api.post("/pet")(body, { throws: false });
if (!res.ok) toast.error(res.message);
```

- 失败是普通对象，不是 `Error`，默认没有 `stack`；`debug` 开启后带调用点。需要 `Error` 的生态（Sentry、TanStack Query）用 `createAxp({ reject: (r) => Object.assign(new Error(r.message ?? ""), { response: r }) })`。
- 响应必需字段只有 ok、status（HTTP，无响应为 0）、code<C extends string | number = number>（缺省 0）、data（缺省 null）。message/raw/error 可选；默认 AxpResponse 另有 request/stack/toJSON/parse。message 默认空串、允许 null。内核失败读 failureOf(r)?.type / reason；取消用 api.isCancel(e) 或 isAxpCancel(e)。HTTP/业务失败看 ok/status/code。
- `isAxpResponse(e)` 与 `api.isResponse(e)` 认的是品牌 `Symbol.for("axp.response")`，不是 `instanceof`，所以 `./min` 与根入口混用时依然成立。
- 程序 bug（中间件、判定类回调、非 AxiosError 的拦截器异常）不会被包装成失败，原样抛出，`throws: false` 也不吞。通知类回调（loading、notify、`onAccessExpired` 等）抛错被隔离并 `console.error`。

## 内核能力

- **取消**：`api.cancelAll(reason?)` 中止全部在途请求并返回数量，`api.pending()` 返回在途数，单个请求传 `signal`。被取消的请求带取消失败标记（api.isCancel 为 true）。`cancelToken` 已移除。
- **key**：内核服务，cache 与 share 用它，惰性计算。`createAxp({ key: { scope } })`，`scope` 可以是函数（切账号不用重建客户端）。请求级 `key`：省略或 `true` 自动算，字符串是显式 key，`false` 表示不参与 cache 与 share。
- **debug**：`createAxp({ debug: true })` 或传自定义 logger `{ log, warn, error }`。关闭时 `ctx.log` 是空函数。
- **生命周期**：`api.use(plugin)`、`api.eject(name)`、`await api.plugin(cache)?.clear()`（`cache` 是装上去的那个插件对象，不是名字）、`api.extend(overrides, { plugins, axios })`（默认继承插件，每个插件重新 `setup`，状态不共享）、`api.dispose()`。

- **缓存快照**：store 条目是 { snapshot, expiresAt }，方法可同步/异步，size 可选；命中新建 R、request 属于当前调用方；管理方法统一 await。get 失败当未命中，写删异常隔离并 console.error，同 key 写入串行且提交前检查屏障。
- **key 语义**：按 axios buildFullPath 并入 baseURL；对象只跳 undefined 字段，null 字段和假值保留，类型标签、字符串原样；二进制 64KiB 内按内容、超出不生成 key。
- **易错边界**：refreshTimeout 默认 30s（0/Infinity 不限时），同客户端刷新要 protected: false；extend 默认只复制 defaults、不复制拦截器，显式 axios 原样使用。完整约束见 [README 警告](../../../README.zh-CN.md#使用警告与业务风格)。

## 自定义响应

字段转换覆盖 parse，成功判定覆盖 ok，status 保留 HTTP。完整[示例和业务风格配置](../../../README.zh-CN.md#自定义响应)以 README 为准。

```ts
import { AxpResponse, axpResponse, createAxp } from "@codejoo/axp";

class MyResponse<D = unknown> extends AxpResponse<D> {
  protected override parse(body: unknown) {
    const value = body as { resultCode?: number; payload?: D } | null;
    return { code: value?.resultCode ?? 0, data: value?.payload ?? null };
  }
  override get ok() {
    return this.status >= 200 && this.status < 300 && this.code === 200;
  }
}
const api = createAxp<Schema, MyResponse>({ response: axpResponse<MyResponse>({ type: MyResponse }) });
```

- 非默认 R 必须提供 response；type 接受子类，create 可返回接口对象，内核补品牌与缺失的 code/data/message。
- 内核在工厂返回后写 AXP_FAILURE 并强制 ok=false；不能让自定义 getter 把取消、超时或程序异常变成功。
- 不用子类字段初始化器重声明 status/code/data/message。parse 在基类构造时调用，不能依赖未初始化的子类字段。
- 缓存重建没有 raw，扩展数据从 init 恢复，不能再用空串等初始化器盖掉。默认类默认成功是 2xx 且 code=0/'0000'。
- 插件工厂泛型内联可推断；单独定义自定义 R 插件时显式写 axpRetry<MyResponse>()。

## 自定义插件

插件是具名对象 `{ name, stage?, enforce?, enable?, setup?, handle?, taps? }`。

```ts
import { createAxp, stateKey } from "@codejoo/axp";
import type { AxpPlugin, AxpResponse } from "@codejoo/axp";

/** 无状态：记录每次尝试的耗时 */
const timing: AxpPlugin<AxpResponse> = {
  name: "timing",
  stage: "attempt", // 默认就是 attempt
  async handle(ctx, next) {
    const t = performance.now();
    const r = await next();
    ctx.log.log(`[timing] ${ctx.request.url} ${r.status} ${performance.now() - t}ms`);
    return r;
  },
};

/** 给内层加 trace 头：不改 ctx.request，用 next(patch) */
const addTrace: AxpPlugin<AxpResponse> = {
  name: "add-trace",
  stage: "prepare",
  handle: (ctx, next) => next({ headers: { "X-Trace": crypto.randomUUID() } }),
};

/** taps：请求侧和响应侧挂在不同阶段 */
const audit: AxpPlugin<AxpResponse> = {
  name: "audit",
  taps: [
    { stage: "credential", enforce: "post", onRequest: (ctx) => report("send", ctx.request) },
    { stage: "outer", onResponse: (r) => report("done", { ok: r.ok, status: r.status, code: r.code }) },
  ],
};

/** 有状态：状态建在 setup 里，每个客户端各一份；api 经 client.plugin(p) 取 */
const attemptKey = stateKey<number>("attempt"); // 请求级状态的类型化键
const counter: AxpPlugin<AxpResponse, { count(): number }> = {
  name: "counter",
  setup() {
    let total = 0;
    return {
      handle: (ctx, next) => {
        total += 1;
        ctx.set(attemptKey, total);
        return next();
      },
      api: { count: () => total },
      dispose() {
        total = 0;
      },
    };
  },
};

const api = createAxp({ plugins: [timing, addTrace, audit] });
api.use(counter);
api.plugin(counter)?.count();
```

- 同一阶段内：`enforce: 'pre'` 的自定义插件在内置插件之前，内置插件居中，`post`（默认）在之后；自定义插件之间按 `plugins` 数组顺序。插件名重复直接抛错，`axp:` 前缀留给内置插件。
- 中间件不改 `ctx.request`。要给内层换请求就调 `next(patch)`：浅合并，`headers` 多合并一层，字段写 `undefined` 表示删除。`next()` 永不抛错，返回的始终是 `R`。
- 重试、重放就是再调一次 `next()`；首发前 markReplayable() 声明按需克隆；每次重放前 ctx.canReplay()，false 就交回原响应。流一旦发送不能重放，强行重发落定时抛原始 Error。
- 请求级状态用 `stateKey<T>()` 建键，`ctx.get(k)`、`ctx.set(k, v)` 读写。凭空造结果用 `ctx.fail({ failure, reason, from })`，由响应工厂保证扩展字段齐全，不要自己 `new`。
- 状态必须建在 `setup` 里，不要放在工厂闭包，否则同一个插件对象装到多个客户端或 `extend` 时状态会串。

## 文件地图（`src/`）

| 文件                       | 职责                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `client.ts`                | `createAxp`、动词分发、`request`、落定 `settle`、`extend`、`use` / `eject`、`cancelAll`、`inspect`、`dispose`      |
| `pipeline.ts`              | 插件排序、taps 编译、链组合、`next(patch)`、异常兜底                                                               |
| `stages.ts`                | `STAGE_BUILTINS`：阶段与内置插件固定次序的唯一来源                                                                 |
| `context.ts`               | `AxpContext`：请求视图、`signal`、`stateKey`、`key()`、`fail()`、`markReplayable()`、`canReplay()`                 |
| `transport.ts`             | 调 `axios.request`，把响应或异常交给响应工厂判定                                                                   |
| `response.ts` / `brand.ts` | 响应契约、默认实现、工厂、`isAxpResponse`；`brand.ts` 零导入，只放 `AXP_RESPONSE`、`AXP_FAILURE` 与 `AXP_FAILURES` |
| `options.ts`               | `resolveOption`：请求级四种写法的统一解析，所有插件共用                                                            |
| `key.ts`                   | key 服务（FNV 双车道哈希，不可哈希的值返回 `null`）                                                                |
| `methods.ts` / `utils.ts`  | 动词分组与方法名规整 / 共用小件                                                                                    |
| `types.ts`                 | Schema 推断、请求选项、插件与客户端类型                                                                            |
| `plugins/*.ts`             | 10 个内置插件，一个插件一个文件；`retry-timing`、`auth-match`、`cache-store` 是内部算法模块，不是入口              |
| `objects/TokenManager.ts`  | `ITokenManager` 与默认实现（内存存放，镜像到 `localStorage`）                                                      |
| `index.ts`                 | 包入口；`package.json` 的 `exports` 为 `.`、`./min`、10 个 `./<name>` 与 `./package.json`                          |

## 改源码时的不变量

- **重放与取消**：一次性体发送后 canReplay 为 false，retry/auth/mock 返回原响应；异步等待后重查取消，已取消请求不能命中缓存。share end/race 的自己取消是撤回，不能成为别人的结果，超时不算撤回。
- **快照与新鲜度**：cache 不保存活的 R、raw/error/stack；命中经工厂重建并绑定当前请求。异步写按 key 串行，提交前检查屏障，clear/dispose 后旧请求不回写。

- **请求不可变，`next()` 不抛错。** 中间件抛出或 reject 都被包成 internal 失败标记 的 `R`，落定时抛 `r.error` 原异常。别在链里 `throw` 一个自造的失败，用 `ctx.fail`。
- **各层看到的是合并过 `defaults` 的请求。** 传输固定 method/baseURL/纯对象 params 的入口视图（含插件补丁），其余未覆盖 defaults 以发送时为准。交给 axios 的差量（原始请求级配置为底，叠上各层改过的字段），层里删掉的默认 `params` 键写成 `null`、默认头写成 `false`，防止 axios 的二次合并把它们带回来。
- **传输强制 `validateStatus: () => true`**，4xx / 5xx 是普通响应，用户 axios 实例上的错误拦截器看不到它们。
- **业务转换与内核事实分开。** 插件读 ok、HTTP status、code，内核失败读 failureOf；标记强制 ok=false。业务码 401/403/5xx/429 不自动路由，自己配 onFailure/shouldRetry/respectRetryAfter。
- **品牌用 `Symbol.for`，识别靠 `isAxpResponse`。** `./min` 自带一份模块实例，`instanceof AxpResponse` 跨入口不可靠；缓存存快照并经工厂重建。
- **插件的请求选项在自己的文件里用 `declare module "../types"` 扩展 `AxpRequestOptions`**，且该插件必须被 `index.ts` 引入，类型增强才会进入使用者的程序。产物里这个相对说明符由构建插件（`vite.config.ts` 的 `dtsAugmentationSpecifier`）改写为 `.mjs`，源码保持 `"../types"`。
- **内置插件名固定为 `axp:<name>`**，位置在 `stages.ts` 里登记；排序按名字定位，不看插件自述的 `stage`。
- cache 的 `clone: 'deep'` 依赖 `structuredClone`，环境没有就在发请求前抛错，不静默降级成浅拷贝。

## 构建与验收

- 门槛：`npm test`（`vp test`，全绿）、覆盖率达标（`vitest.config.ts`：行 95 / 分支 90 / 函数 95，内核四文件 `pipeline`、`context`、`response`、`transport` 分支 100%，加 `--coverage` 才检查）、tsgo 零错误、`npm run build`、`npm run check`。
- 格式与 lint 用项目配置：`npm run fmt`、`npm run check`（printWidth 220，类型感知 lint）。别用不带 `-c` 的裸 `vp check`。`.gitattributes` 固定 LF，工作区里若出现 CRLF 先转回 LF。
- 测试分六层：`test/{unit,rule,boundary,combo,integration}` 加验收 `accept/`；`test/helpers/` 放共用支撑（`client.ts`、`network.ts`、`invariants.ts` 等），不会被 vitest 当用例。规则见 `docs/guides/test-layers.md` 与 `docs/design/test-plan.md`。
- `test/integration/dist.integration.test.ts` 验证 `dist` 而不是 `src`：`exports` 清单、子路径可导入、旧子路径与内部模块不可导入、`./min` 与根入口互认、nodenext 与 bundler 消费方类型检查；`dist` 过期会自动先 `npm run build`。
- `e2e/` 是 Playwright 真浏览器用例，演练场在 `e2e/playground`：`npm run e2e`（全量，`run.mjs`）或 `npm run e2e:int`（只跑并发集成卡片）。增删公开 API 时，`run.mjs` 的 `cases` 要和演练场的 `data-testid` 同步。
- `npm run accept` 先 `vp pack` 再对接 testkit 做黑盒验收；`accept/` 里的执行器直接用 Node 原生加载 `brand.ts`。

## 新增内置插件

1. 新建 `src/plugins/<name>.ts`，默认导出泛型工厂 `axpXxx<R extends IAxpResponse = AxpResponse>(options?): AxpPlugin<R, Api>`；`name` 取 `axp:<name>`，状态全部建在 `setup` 里，支持 `enable?: boolean`。
2. 在 `src/stages.ts` 的 `STAGE_BUILTINS` 里登记阶段与阶段内次序。需要请求级选项就用 `AxpOption<…>` 和 `resolveOption`，类型用 `declare module "../types"` 扩展 `AxpRequestOptions`。
3. 从 `src/index.ts` 导出（值与类型），同步 `package.json` 的 `exports`、`vite.config.ts` 的 `PLUGIN_NAMES`，以及 `index.unit.test.ts` 与 `dist.integration.test.ts` 里的清单。
4. 补各层用例，并在 `README.md`、`README.zh-CN.md`、`docs/design/plugin-spec.md` 里写选项表；文档目录有变动时按 `docs/README.md` 更新索引。
